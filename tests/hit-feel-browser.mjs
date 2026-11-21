// Run against npm run dev: hits land (freeze, shake, hurt pose, spark, knockback slide) and misses swish,
// in the practice scene, stepped one frame at a time. Screenshots of the freeze go to previews/.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const character = process.env.CHARACTER ?? 'titus';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } }), errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173'}/?practice=1&character=${character}`);
  await page.waitForFunction(() => window.pixelforgePlay?.state().level === 'combat-practice');
  await page.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    play.freeze();
    window.setupFight = (distance = 20) => {
      s.health.reset(); s.partnerHealth.reset();
      s.player.body.reset(300, 220); s.partner.body.reset(300 + distance, 220);
      s.player.controller.facing = 'right'; s.partner.controller.facing = 'left';
      for (const c of [s.combat, s.partnerCombat]) {
        c.rules.attack = null; c.rules.block = null; c.rules.readyAt = {}; c.rules.previous = {}; c.rules.blockReadyAt = 0;
        c.rules.staggerUntil = 0; c.controller.stunnedUntil = 0; c.controller.busy = null; c.push = null;
      }
      play.step(300, {});
    };
    // Step a frame at a time until `until()` holds; returns how many ms that took.
    window.stepUntil = (input, until, max = 1500) => {
      for (let t = 0; t <= max; t += 1000 / 60) { if (until()) return t; play.step(1000 / 60, input); }
      return null;
    };
    window.effects = (key) => s.children.list.filter(o => o.texture?.key === key && o.active).length;
  });

  const results = {};
  for (const move of ['punch', 'kick']) {
    results[move] = await page.evaluate((move) => {
      const play = window.pixelforgePlay, s = play.scene;
      setupFight(move === 'kick' ? 28 : 20);
      const start = s.partner.x;
      const toContact = stepUntil({ [move]: true }, () => !!s.partner.hitFreeze);
      const frozen = { partner: !!s.partner.hitFreeze, player: !!s.player.hitFreeze,
        partnerPlaying: s.partner.anims.isPlaying, playerPlaying: s.player.anims.isPlaying,
        anim: s.partner.anims.currentAnim?.key, spark: effects('fx_hit'), damage: s.partnerHealth.max - s.partnerHealth.value };
      const xs = [];
      let held = 0;
      while (s.partner.hitFreeze && held < 400) { play.step(1000 / 60, {}); xs.push(Math.round(s.partner.x - start)); held += 1000 / 60; }
      const released = s.partner.x - start;
      play.step(400, {});
      return { toContact, frozen, held, jitter: [...new Set(xs)], released, slid: s.partner.x - start,
        canAct: play.state().partnerCombat.staggerRemaining === 0 };
    }, move);
    await page.screenshot({ path: `previews/hit-feel-${character}-${move}.png`, clip: { x: 440, y: 260, width: 400, height: 260 } });
  }
  // Freeze-frame screenshots: step to the first frame of contact and capture it.
  await page.evaluate(() => { setupFight(20); stepUntil({ punch: true }, () => !!window.pixelforgePlay.scene.partner.hitFreeze); window.pixelforgePlay.step(1000 / 60, {}); });
  await page.screenshot({ path: `previews/hit-feel-${character}-contact.png` });

  // The exchange: the partner winds up a punch, the player's lands first and cancels it.
  const exchange = await page.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    setupFight(20);
    s.partnerCombat.rules.update(s.time.now, { punch: true }, 'left');
    s.partnerCombat.rules.attack.start = s.time.now - 40;   // they're already 40ms into the wind-up
    stepUntil({ punch: true }, () => !!s.partner.hitFreeze);
    const cancelled = s.partnerCombat.rules.attack === null;
    play.step(600, {});
    return { cancelled, playerHealth: s.health.value, max: s.health.max };
  });

  // A miss: no freeze, a swish.
  const whiff = await page.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    setupFight(120);
    let swish = 0, froze = false;
    for (let t = 0; t < 600; t += 1000 / 60) {
      play.step(1000 / 60, t < 30 ? { punch: true } : {});
      swish = Math.max(swish, effects('fx_swish')); froze ||= !!s.player.hitFreeze;
    }
    return { swish, froze };
  });
  await page.evaluate(() => { setupFight(120); window.pixelforgePlay.step(17, { punch: true }); stepUntil({}, () => effects('fx_swish') > 0, 600); window.pixelforgePlay.step(34, {}); });
  await page.screenshot({ path: `previews/hit-feel-${character}-whiff.png`, clip: { x: 440, y: 260, width: 400, height: 260 } });

  // A blocked hit: blue spark, shorter freeze, no shake.
  // (The practice partner can't hold a key, so the player blocks and the partner's punch lands the way
  // TitusCombat.checkHits lands it.)
  const block = await page.evaluate(async () => {
    const play = window.pixelforgePlay, s = play.scene, { ATTACKS } = await import('/src/combat/rules.js');
    setupFight(20);
    play.step(1000 / 60, { block: true });
    play.step(150, { block: true });   // past the perfect-block window: an ordinary block
    const result = s.combat.receive(s.partner, ATTACKS.punch);
    s.hitFeel.land(s.partner, s.player, 'punch', result);
    return { blocked: result.blocked, blockSpark: effects('fx_block'), hitSpark: effects('fx_hit'), shaking: s.player.hitFreeze?.shake,
      freeze: s.player.hitFreeze.until - s.time.now };
  });

  console.log(JSON.stringify({ results, exchange, whiff, block, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const [move, r] of Object.entries(results)) {
    assert.ok(r.frozen.partner && r.frozen.player, `${move}: both fighters freeze`);
    assert.ok(!r.frozen.partnerPlaying && !r.frozen.playerPlaying, `${move}: both poses pause`);
    assert.match(r.frozen.anim, /_hurt_side$/, `${move}: the victim flinches into the hurt pose`);
    assert.equal(r.frozen.spark, 1, `${move}: a spark`);
    assert.ok(r.frozen.damage > 0);
    const want = { punch: 60, kick: 90 }[move];
    assert.ok(Math.abs(r.held - want) <= 20, `${move}: frozen ~${want}ms (${r.held.toFixed(0)})`);
    assert.ok(r.jitter.includes(-1) && r.jitter.includes(1), `${move}: the victim shakes in place`);
    assert.ok(Math.abs(r.released) <= 1, `${move}: no slide during the freeze`);
    const dist = { punch: [6, 8.5], kick: [14, 16.5] }[move];
    assert.ok(r.slid >= dist[0] && r.slid <= dist[1], `${move}: slid ${r.slid.toFixed(1)}px`);
    assert.ok(r.canAct, `${move}: the flinch ends`);
  }
  assert.ok(exchange.cancelled, 'the first clean hit cancels the other wind-up');
  assert.equal(exchange.playerHealth, exchange.max, 'no trade');
  assert.ok(whiff.swish >= 1 && !whiff.froze, 'a miss swishes and never freezes');
  assert.ok(block.blocked); assert.equal(block.blockSpark, 1); assert.equal(block.hitSpark, 0);
  assert.equal(block.shaking, false); assert.equal(block.freeze, 30, 'a blocked punch freezes half as long');
  console.log('passed');
} finally { await browser.close(); }
