// Run against npm run dev, two players (host James, guest Mason), the controls pass online:
//   the guest's perfect block stops the host's punch: no damage, the host is staggered, both screens say PERFECT;
//   the guest dodges through the host's punch untouched, and the host's screen sees the dodge;
//   the guest grabs the host, who mashes out sooner than the 2 s hold; the choke lands; "MASH!" on both screens;
//   the host Bellows the guest, who shakes the 5 s stun off sooner and can walk again.
// Screenshots go to previews/controls-net-*.png.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', errors = [], pages = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('previews', { recursive: true });
try {
  for (const character of ['james', 'mason']) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    page.on('pageerror', e => errors.push(`${character}: ${e.message}`));
    await page.goto(`${baseUrl}/?solo&character=${character}`);
    await page.waitForFunction(() => window.pixelforgePlay?.player?.combat);
    pages.push(page);
  }
  const [host, guest] = pages;
  const room = await host.evaluate(async () => { await brockNet.host({ name: 'Host', level: 'brock3' }); return brockNet.room; });
  await guest.evaluate(async room => { await brockNet.join({ name: 'Guest', room }); }, room);
  for (const page of pages) await page.waitForFunction(() => brockNet.count === 2);
  for (const page of pages) await page.evaluate(() => {
    window.hits = [];
    brockNet.on('combat', ({ hits }) => { for (const h of hits) window.hits.push({ ...h, at: performance.now() }); });
    window.words = () => window.pixelforgePlay.scene.children.list.filter(o => o.type === 'Text' && o.active && o.visible).map(o => o.text);
    window.health = () => window.pixelforgePlay.scene.combat.rules.health.value;
    // Alternate `keys` and nothing every 40 ms until done() or ms run out; resolves with how long it took.
    window.mash = (keys, done, ms) => new Promise(resolve => {
      const p = window.pixelforgePlay.player, start = performance.now();
      let on = false;
      const tick = setInterval(() => {
        if (done() || performance.now() - start > ms) { clearInterval(tick); p.controller.override = {}; resolve(performance.now() - start); return; }
        on = !on; p.controller.override = on ? keys : {};
      }, 40);
    });
  });
  const place = async (gap) => {
    await host.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200, 650); p.controller.facing = 'right'; });
    await guest.evaluate(gap => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200 + gap, 650); p.controller.facing = 'left'; }, gap);
    await wait(600);
    for (const page of pages) await page.evaluate(() => { window.hits = []; });
  };
  const hold = (page, keys) => page.evaluate(k => { window.pixelforgePlay.player.controller.override = k; }, keys);

  // Perfect block: the guest's block goes up just before the host's punch lands.
  await place(24);
  const guestBefore = await guest.evaluate(() => health());
  await hold(guest, { block: true });
  await wait(20);
  await hold(host, { punch: true });
  await wait(250);
  const perfectWords = { host: await host.evaluate(() => words()), guest: await guest.evaluate(() => words()) };
  await host.screenshot({ path: 'previews/controls-net-perfect.png' });
  await hold(host, {}); await hold(guest, {});
  await wait(300);
  const perfect = { guestLost: guestBefore - await guest.evaluate(() => health()), hits: await host.evaluate(() => window.hits.map(h => ({ target: h.target, move: h.move, perfect: !!h.perfect, parried: !!h.parried }))) };
  await wait(1200);   // the block cooldown and the parry stagger run out

  // Dodge: the guest hops through the host's punch.
  await place(24);
  const beforeDodge = await guest.evaluate(() => health());
  await host.evaluate(() => { window.sawDodge = false; const id = Object.keys(brockNet.players)[0]; window.dodgeWatch = setInterval(() => { if (brockNet.players[id]?.dodge) window.sawDodge = true; }, 10); });
  await hold(guest, { dodge: true, down: true });
  await hold(host, { punch: true });
  await wait(120); await hold(guest, {}); await wait(300); await hold(host, {});
  const dodge = { lost: beforeDodge - await guest.evaluate(() => health()), sawDodge: await host.evaluate(() => { clearInterval(window.dodgeWatch); return window.sawDodge; }) };
  await wait(800);

  // Grapple: the guest grabs the host; the host mashes.
  await place(18);
  const hostBefore = await host.evaluate(() => health());
  await hold(guest, { grapple: true });
  await host.waitForFunction(() => !!brockNet.combatState.fighters[brockNet.id]?.held, null, { timeout: 3000 });
  await hold(guest, {});
  await wait(150);
  const mashShown = {
    host: await host.evaluate(() => !!window.pixelforgePlay.scene.marks.mashes.get(window.pixelforgePlay.player)?.visible),
    guest: await guest.evaluate(() => [...window.pixelforgePlay.scene.marks.mashes.values()].some(t => t.visible)),
  };
  await guest.screenshot({ path: 'previews/controls-net-mash.png' });
  const heldFor = 150 + await host.evaluate(() => window.mash({ punch: true }, () => !brockNet.combatState.fighters[brockNet.id]?.held, 3000));
  await wait(400);
  const grapple = { heldFor, hostLost: hostBefore - await host.evaluate(() => health()),
    choke: (await guest.evaluate(() => window.hits)).find(h => h.move === 'grapple')?.damage ?? 0 };
  await wait(1500);

  // Bellow: the host stuns the guest, who shakes it off.
  await place(60);
  await hold(host, { bellow: true });
  await guest.waitForFunction(() => window.pixelforgePlay.scene.time.now < window.pixelforgePlay.scene.combat.rules.stunUntil, null, { timeout: 3000 });
  await hold(host, {});
  const stunnedFor = await guest.evaluate(() => { const s = window.pixelforgePlay.scene; return window.mash({ right: true }, () => s.time.now >= s.combat.rules.stunUntil, 6000); });
  await wait(250);
  const x0 = await guest.evaluate(() => window.pixelforgePlay.player.x);
  await hold(guest, { right: true }); await wait(400); await hold(guest, {});
  const walked = (await guest.evaluate(() => window.pixelforgePlay.player.x)) - x0;

  console.log(JSON.stringify({ perfectWords, perfect, dodge, mashShown, grapple, stunnedFor, walked, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(perfect.guestLost, 0, 'a perfect block takes nothing');
  assert.ok(perfect.hits.some(h => h.target !== 'h' && h.perfect), 'the host saw a perfect block');
  assert.ok(perfect.hits.some(h => h.target === 'h' && h.parried), 'and staggered its own punch');
  assert.ok(perfectWords.host.includes('PERFECT') && perfectWords.guest.includes('PERFECT'), 'both screens say PERFECT');
  assert.equal(dodge.lost, 0, 'the dodge goes through the punch');
  assert.ok(dodge.sawDodge, 'the host hears about the dodge');
  assert.ok(mashShown.host && mashShown.guest, '"MASH!" over the held host on both screens');
  assert.ok(grapple.heldFor >= 600 && grapple.heldFor < 1800, `mashed out in ${Math.round(grapple.heldFor)} ms of a 2000 ms hold`);
  assert.equal(grapple.choke, 25, 'the choke still lands');
  assert.ok(stunnedFor < 3600, `shook off the Bellow in ${Math.round(stunnedFor)} ms of 5000`);
  assert.ok(walked > 20, 'and walks again');
  console.log('controls online ok');
} finally {
  await browser.close();
}
