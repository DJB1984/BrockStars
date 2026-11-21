// Run against npm run dev: the controls pass ("controls that feel effortless"), in real browsers.
//   practice (Titus vs the partner): a tap aims at the partner, a held arrow overrides it; a press made a moment
//     early is buffered, one made too early isn't; a perfect block takes nothing and staggers the partner, a late
//     one covers the side; the dodge is hidden, so pressing it does nothing;
//   practice (Mason): the grabbed partner mashes out of Grapple sooner, and the choke still lands; "MASH!" shows;
//   practice (James): the stunned partner shakes off Bellow sooner;
//   a level: five keycaps with the layout's keys, the Controls menu switches to WASD (and the keys follow);
//   touch: Punch fires the moment it's pressed; dragging it does nothing more.
// Screenshots go to previews/controls-*.png for a look.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('previews', { recursive: true });

async function practice(character) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  page.on('pageerror', e => errors.push(`${character}: ${e.message}`));
  await page.goto(`${baseUrl}/?practice=1&character=${character}`);
  await page.waitForFunction(() => window.pixelforgePlay?.player?.combat && window.pixelforgePlay.scene.partnerCombat);
  await page.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    // Both fighters back to fresh, at (px, py) and (qx, qy).
    window.reset = (px, py, qx, qy, facing = 'right') => {
      for (const c of [s.combat, s.partnerCombat]) {
        c.rules.health.reset();
        Object.assign(c.rules, { attack: null, block: null, dodge: null, buffered: null, previous: {}, staggerUntil: 0, knockedDownUntil: 0, blockReadyAt: 0, invulnerableUntil: 0, heldBy: null });
        c.cancelGrapple(); c.push = null; c.controller.stunnedUntil = 0; c.controller.busy = null; c.sprite.grabImmuneUntil = 0; c.rules.grabImmuneUntil = 0;
      }
      s.partnerKeys = {};
      s.player.body.reset(px, py); s.partner.body.reset(qx, qy); s.player.controller.facing = facing;
      play.step(100, {});
    };
    window.attacks = [];
    s.player.on('pixelforge-attack', () => window.attacks.push({ name: s.combat.rules.attack?.name, facing: s.combat.rules.attack?.facing }));
    window.parries = 0;
    const parry = s.hitFeel.parry.bind(s.hitFeel);
    s.hitFeel.parry = (...a) => { window.parries++; return parry(...a); };
    window.words = () => s.children.list.filter(o => o.type === 'Text' && o.active && o.visible).map(o => o.text);
  });
  return page;
}

try {
  // ---- Titus in practice -----------------------------------------------------------------------------
  const titus = await practice('titus');
  const t = await titus.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene, out = {};
    // Tap: the partner is below, you face right. The punch goes down and lands.
    reset(280, 220, 280, 250); attacks.length = 0;
    play.step(17, { punch: true }); play.step(400, {});
    out.tap = { facing: attacks[0]?.facing, partnerHurt: s.partnerHealth.value < s.partnerHealth.max };
    // A held arrow keeps its direction.
    reset(280, 220, 280, 250); attacks.length = 0;
    play.step(17, { punch: true, left: true }); play.step(400, {});
    out.held = { facing: attacks[0]?.facing, partnerHurt: s.partnerHealth.value < s.partnerHealth.max };
    // Buffer: kick pressed 150 ms into a 320 ms punch comes out right after it; pressed at 50 ms it doesn't.
    reset(280, 220, 500, 220); attacks.length = 0;
    play.step(17, { punch: true }); play.step(190, {}); play.step(17, { kick: true }); play.step(17, {}); play.step(400, {});
    out.buffered = attacks.map(a => a.name);
    reset(280, 220, 500, 220); attacks.length = 0;
    play.step(17, { punch: true }); play.step(50, {}); play.step(17, { kick: true }); play.step(17, {}); play.step(400, {});
    out.tooEarly = attacks.map(a => a.name);
    return out;
  });

  // Every hit the player takes, with when its block went up.
  await titus.evaluate(() => {
    const s = window.pixelforgePlay.scene, recv = s.combat.receive.bind(s.combat);
    window.received = [];
    s.combat.receive = (from, spec) => { const r = recv(from, spec); received.push({ ...r, intoBlock: s.combat.rules.block ? s.time.now - s.combat.rules.block.start : null }); return r; };
    // Step until the player has been hit (or ms run out), holding `keys`.
    window.untilHit = (keys, ms = 400) => { const play = window.pixelforgePlay, n = received.length; for (let t = 0; t < ms && received.length === n; t += 17) play.step(17, keys); };
  });
  // Perfect block: the partner throws a punch and the block goes up just before it lands. Screenshot the moment.
  const perfect = await titus.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    reset(280, 220, 306, 220); parries = 0; received.length = 0;
    s.partnerKeys = { punch: true }; play.step(34, {}); s.partnerKeys = {};
    untilHit({ block: true });
    return { hit: received[0], health: s.health.value, max: s.health.max, parries, partnerStaggered: s.partnerCombat.rules.staggerUntil > s.time.now, words: words() };
  });
  await titus.screenshot({ path: 'previews/controls-perfect.png' });
  await titus.evaluate(() => { window.pixelforgePlay.step(400, {}); });
  // A late block, hit from the side (partner above, block facing right): covered, for a quarter.
  const side = await titus.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    reset(280, 230, 280, 204); parries = 0; received.length = 0;
    play.step(17, { block: true }); play.step(300, { block: true });
    s.partnerKeys = { punch: true }; play.step(34, { block: true }); s.partnerKeys = {};
    untilHit({ block: true });
    return { hit: received[0], health: s.health.value, max: s.health.max, parries, block: s.combat.rules.block?.facing };
  });
  await titus.screenshot({ path: 'previews/controls-block-side.png' });
  await titus.evaluate(() => { window.pixelforgePlay.step(400, {}); });

  // The dodge is hidden: pressing it does nothing (no hop, no cooldown).
  const dodge = await titus.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    reset(280, 220, 500, 220);
    const x0 = s.player.x;
    play.step(17, { dodge: true }); play.step(200, {});
    return { moved: s.player.x - x0, dodged: !!s.combat.rules.dodge, cooldown: s.combat.snapshot().cooldowns.dodge };
  });

  // ---- Mason: the grabbed partner mashes out ------------------------------------------------------------
  const mason = await practice('mason');
  const grab = await mason.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    reset(280, 220, 300, 220);
    play.step(17, { grapple: true });
    let t = 0;
    while (!s.partnerCombat.rules.heldBy && t < 800) { play.step(17, {}); t += 17; }
    return { held: !!s.partnerCombat.rules.heldBy, at: s.time.now };
  });
  await mason.evaluate(() => { const play = window.pixelforgePlay, s = play.scene; for (let i = 0; i < 6; i++) { s.partnerKeys = i % 2 ? {} : { punch: true }; play.step(34, {}); } });
  await mason.screenshot({ path: 'previews/controls-mash-grapple.png' });
  const mashed = await mason.evaluate(({ at }) => {
    const play = window.pixelforgePlay, s = play.scene, shown = !!s.marks.mashes.get(s.partner)?.visible;
    let i = 0;
    while (s.partnerCombat.rules.heldBy && s.time.now - at < 2500) { s.partnerKeys = i++ % 2 ? {} : { [['up', 'punch', 'left', 'kick'][i % 4]]: true }; play.step(34, {}); }
    const released = s.time.now - at;
    s.partnerKeys = {}; play.step(300, {});
    return { released, shown, partnerHealth: s.partnerHealth.value, max: s.partnerHealth.max, immune: (s.partner.grabImmuneUntil ?? 0) > at };
  }, grab);

  // ---- James: the stunned partner shakes off Bellow -----------------------------------------------------
  const james = await practice('james');
  const stun = await james.evaluate(() => {
    const play = window.pixelforgePlay, s = play.scene;
    reset(280, 220, 330, 220);
    play.step(17, { bellow: true });
    let t = 0;
    while (s.time.now >= s.partnerCombat.rules.stunUntil && t < 1000) { play.step(17, {}); t += 17; }
    const start = s.time.now, natural = s.partnerCombat.rules.stunUntil - start;
    let i = 0;
    while (s.time.now < s.partnerCombat.rules.stunUntil && s.time.now - start < 6000) { s.partnerKeys = i++ % 2 ? {} : { right: true }; play.step(34, {}); }
    const lasted = s.time.now - start;
    s.partnerKeys = {}; play.step(100, {});
    return { natural, lasted, canMove: s.time.now >= s.partnerCombat.rules.staggerUntil };
  });

  // ---- A level: keycaps and the keyboard layout --------------------------------------------------------
  const level = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  level.on('pageerror', e => errors.push(`level: ${e.message}`));
  await level.goto(`${baseUrl}/?solo&character=titus`);
  await level.waitForFunction(() => window.pixelforgePlay?.player?.combat && document.querySelectorAll('.hud-keys .mk').length);
  const keys = () => level.$$eval('.hud-keys .mk-key', els => els.map(e => e.textContent));
  const arrowsKeys = await keys();
  await level.keyboard.press('Escape');
  await level.click('text=Controls');
  await level.click('.layout-pick >> text=WASD');
  await level.screenshot({ path: 'previews/controls-menu-wasd.png' });
  const stored = await level.evaluate(() => localStorage.getItem('brockstars.keys'));
  await level.keyboard.press('Escape');
  await wait(200);
  const wasdKeys = await keys();
  await level.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = null; p.body.reset(1200, 650); });
  await level.keyboard.down('j'); await wait(60);
  const jPunch = await level.evaluate(() => window.pixelforgePlay.player.combat.rules.attack?.name ?? null);
  await level.keyboard.up('j'); await wait(500);
  await level.keyboard.down('c'); await wait(60);
  const cNothing = await level.evaluate(() => window.pixelforgePlay.player.combat.rules.attack?.name ?? null);
  await level.keyboard.up('c'); await wait(300);
  const x0 = await level.evaluate(() => window.pixelforgePlay.player.x);
  await level.keyboard.down('d'); await wait(300); await level.keyboard.up('d');
  const dWalks = (await level.evaluate(() => window.pixelforgePlay.player.x)) - x0;
  await level.evaluate(async () => (await import('/src/controls.js')).setLayout('arrows'));
  await wait(100);
  const backKeys = await keys();

  // ---- Touch: Punch fires the moment it's pressed, at the nearest; there's no drag to aim -------------
  const phone = await (await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
  phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
  await phone.goto(`${baseUrl}/?solo&character=titus&touch=1`);
  await phone.waitForFunction(() => window.pixelforgePlay?.player?.combat && document.querySelectorAll('.arc .mk').length);
  await phone.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = null; p.body.reset(1200, 650); p.controller.facing = 'right';
    window.attacks = []; p.on('pixelforge-attack', () => window.attacks.push(p.combat.rules.attack?.facing)); });
  await wait(300);
  await phone.screenshot({ path: 'previews/controls-touch.png' });
  const buttons = await phone.$$eval('.arc .arc-key', els => els.map(e => { const r = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label'), w: Math.round(r.width), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const punchBtn = buttons.find(b => b.label === 'Punch');
  await phone.mouse.move(punchBtn.x, punchBtn.y); await phone.mouse.down(); await wait(80);
  const onPress = await phone.evaluate(() => window.attacks.length);
  await phone.mouse.up(); await wait(500);
  // Pressed and dragged up: still one punch, at the press, and no aim drawn.
  await phone.mouse.move(punchBtn.x, punchBtn.y); await phone.mouse.down();
  await phone.mouse.move(punchBtn.x, punchBtn.y - 70, { steps: 4 }); await wait(80);
  await phone.mouse.up(); await wait(150);
  const dragged = await phone.evaluate(() => window.attacks.slice());

  console.log(JSON.stringify({ t, perfect, side, dodge, grab, mashed, stun, arrowsKeys, stored, wasdKeys, jPunch, cNothing, dWalks, backKeys,
    buttons, onPress, dragged, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(t.tap, { facing: 'down', partnerHurt: true }, 'a tap punches the partner below');
  assert.deepEqual(t.held, { facing: 'left', partnerHurt: false }, 'a held arrow overrides the aim');
  assert.deepEqual(t.buffered, ['punch', 'kick'], 'kick pressed 150 ms early comes out');
  assert.deepEqual(t.tooEarly, ['punch'], 'kick pressed 270 ms early is dropped');
  assert.equal(perfect.health, perfect.max, 'a perfect block takes nothing');
  assert.equal(perfect.parries, 1); assert.ok(perfect.partnerStaggered, 'and staggers the attacker');
  assert.ok(perfect.words.includes('PERFECT'));
  assert.equal(side.parries, 0); assert.equal(side.max - side.health, 1, 'a late block from the side takes a quarter');
  assert.deepEqual(dodge, { moved: 0, dodged: false, cooldown: 0 }, 'the hidden dodge does nothing');
  assert.ok(grab.held, 'Mason holds the partner');
  assert.ok(mashed.shown, '"MASH!" over the held partner');
  assert.ok(mashed.released >= 600 && mashed.released < 1700, `mashed out in ${mashed.released} ms of a 2000 ms hold`);
  assert.equal(mashed.max - mashed.partnerHealth, 25, 'the choke still lands');
  assert.ok(mashed.immune, 'no regrab for a second');
  assert.ok(stun.natural >= 4900, 'Bellow stuns for 5 s');
  assert.ok(stun.lasted >= 1000 && stun.lasted < 3500, `shaken off in ${stun.lasted} ms`);
  assert.ok(stun.canMove, 'and free to move');
  assert.deepEqual(arrowsKeys, ['C', 'X', 'Z', 'V', 'S'], 'five keycaps: no dodge');
  assert.equal(stored, 'wasd');
  assert.deepEqual(wasdKeys, ['J', 'K', 'L', 'I', 'U']);
  assert.equal(jPunch, 'punch', 'J punches in the WASD layout');
  assert.equal(cNothing, null, 'C does nothing in it');
  assert.ok(dWalks > 20, 'D walks right');
  assert.deepEqual(backKeys, arrowsKeys);
  const size = Object.fromEntries(buttons.map(b => [b.label, b.w]));
  assert.ok(size.Punch > size.Kick && size.Kick > size.Headbutt, `sized by use: ${JSON.stringify(size)}`);
  assert.ok(!('Dodge' in size), 'no dodge button');
  assert.equal(onPress, 1, 'a press fires at once');
  assert.deepEqual(dragged, ['right', 'right'], 'dragging changes nothing: one punch per press, facing as it was');
  console.log('controls ok');
} finally {
  await browser.close();
}
