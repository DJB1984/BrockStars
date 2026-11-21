// Run against npm run dev: a hit the host resolves is felt on both screens (the victim frozen in the hurt
// pose, the attacker frozen, a spark, the camera shaking for both), and a miss swishes on both.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', errors = [], pages = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  for (const character of ['mason', 'titus']) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${baseUrl}/?solo&character=${character}`);
    await page.waitForFunction(() => window.pixelforgePlay?.player?.combat);
    pages.push(page);
  }
  const [host, guest] = pages;
  const room = await host.evaluate(async () => { await brockNet.host({ name: 'Host', level: 'brock3' }); return brockNet.room; });
  await guest.evaluate(async room => { await brockNet.join({ name: 'Guest', room }); }, room);
  for (const page of pages) await page.waitForFunction(() => brockNet.count === 2);
  // Log every land/whiff with what the screen showed at that moment, and every pose the remote sprites play.
  for (const page of pages) await page.evaluate(() => {
    const s = window.pixelforgePlay.scene, feel = s.hitFeel, me = window.pixelforgePlay.player;
    const who = o => o === me ? 'me' : o ? 'remote' : null;
    window.feelLog = []; window.remoteAnims = new Set(); window.shakes = 0;
    const land = feel.land.bind(feel), whiff = feel.whiff.bind(feel), shake = s.feel.shake;
    s.feel.shake = (...a) => { window.shakes++; return shake(...a); };
    feel.land = (a, v, move, result, opts) => {
      land(a, v, move, result, opts);
      window.feelLog.push({ kind: 'land', move, attacker: who(a), victim: who(v), victimFrozen: !!v?.hitFreeze, attackerFrozen: !!a?.hitFreeze,
        victimAnim: v?.anims.currentAnim?.key ?? null, sparks: s.children.list.filter(o => o.texture?.key === 'fx_hit').length });
    };
    feel.whiff = (a, move, facing) => { whiff(a, move, facing); window.feelLog.push({ kind: 'whiff', move, attacker: who(a),
      swish: s.children.list.filter(o => o.texture?.key === 'fx_swish').length }); };
    s.events.on('postupdate', () => { for (const r of s.remotes.sprites()) window.remoteAnims.add(r.anims.currentAnim?.key + (r.hitFreeze ? ' frozen' : '')); });
  });
  const place = async (gap) => {
    await host.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200, 650); p.controller.facing = 'right'; });
    await guest.evaluate(gap => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200 + gap, 650); p.controller.facing = 'left'; }, gap);
    await wait(400);
    for (const page of pages) await page.evaluate(() => { window.feelLog = []; window.remoteAnims.clear(); window.shakes = 0; });
  };
  const press = async (page, keys, ms = 120) => { await page.evaluate(k => { window.pixelforgePlay.player.controller.override = k; }, keys); await wait(ms);
    await page.evaluate(() => { window.pixelforgePlay.player.controller.override = {}; }); };
  const read = page => page.evaluate(() => ({ log: window.feelLog, anims: [...window.remoteAnims], shakes: window.shakes }));

  await place(20);
  await press(host, { punch: true });
  await guest.waitForFunction(() => window.feelLog.some(e => e.kind === 'land'));
  await wait(500);
  const hit = { host: await read(host), guest: await read(guest) };

  await place(140);
  await press(host, { punch: true });
  await wait(900);
  const miss = { host: await read(host), guest: await read(guest) };
  console.log(JSON.stringify({ hit, miss, errors }, null, 2));

  assert.deepEqual(errors, []);
  const g = hit.guest.log.find(e => e.kind === 'land'), h = hit.host.log.find(e => e.kind === 'land');
  assert.ok(g && g.move === 'punch' && g.attacker === 'remote' && g.victim === 'me', 'the guest feels the host\'s punch');
  assert.ok(g.victimFrozen && g.attackerFrozen, 'guest screen: both fighters freeze');
  assert.equal(g.victimAnim, 'titus_hurt_side', 'guest screen: frozen in the hurt pose');
  assert.equal(g.sparks, 1);
  assert.ok(h && h.attacker === 'me' && h.victim === 'remote' && h.victimFrozen && h.sparks === 1, 'the host feels its own punch land');
  assert.ok(hit.host.anims.some(a => /titus_hurt_side frozen/.test(a)), `host screen: the guest frozen in the hurt pose (${hit.host.anims})`);
  assert.ok(hit.guest.shakes >= 1 && hit.host.shakes >= 1, 'both people in the fight feel the shake');
  assert.ok(miss.host.log.some(e => e.kind === 'whiff' && e.attacker === 'me' && e.swish === 1), 'the host sees its own miss swish');
  assert.ok(miss.guest.log.some(e => e.kind === 'whiff' && e.attacker === 'remote'), 'the guest sees the host\'s miss swish');
  assert.ok(!miss.host.log.some(e => e.kind === 'land') && !miss.guest.log.some(e => e.kind === 'land'));
  console.log('passed');
} finally { await browser.close(); }
