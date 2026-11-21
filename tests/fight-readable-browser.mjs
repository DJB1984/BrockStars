// Run against npm run dev: solo, every move has a keycap that goes down while it cools, a move pressed while
// cooling is a dud (the cap wiggles, the HUD hears it), your feet have an amber ring with a second one while
// the Super is ready, heavy moves glint (no Super shows its hit zone), and a block draws a shield.
// Screenshots go to previews/fight-readable-*.png for a look.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('previews', { recursive: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${baseUrl}/?solo&character=titus`);
  await page.waitForFunction(() => window.pixelforgePlay?.player?.combat && document.querySelectorAll('.hud-keys .mk').length);
  const press = async (keys, ms = 120) => {
    await page.evaluate(k => { window.pixelforgePlay.player.controller.override = k; }, keys); await wait(ms);
    await page.evaluate(() => { window.pixelforgePlay.player.controller.override = {}; }); await wait(60);
  };
  await page.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200, 650); p.controller.facing = 'right'; });
  await wait(300);
  const caps = await page.$$eval('.hud-keys .mk', els => els.map(e => ({ key: e.querySelector('.mk-key')?.textContent, text: e.innerText.replace(e.querySelector('.mk-key')?.textContent ?? '', '').trim() })));
  const marks = () => page.evaluate(() => {
    const s = window.pixelforgePlay.scene, me = window.pixelforgePlay.player;
    return { fighters: s.marks.fighters().map(f => ({ mine: f.mine, superReady: f.superReady, block: f.block })),
      telegraphs: s.marks.telegraphs.map(t => ({ move: t.move, glint: !!t.glint?.active })),
      shield: !!s.marks.shields.get(me)?.[0].visible, floorDrawn: s.marks.floor.commandBuffer.length };
  });
  const start = await marks();

  // Kick: its cap goes down. Kick again while it cools: a dud, and the cap wiggles.
  await press({ kick: true });
  const kickCap = await page.$eval('.hud-keys .mk:nth-child(2)', el => el.className);
  await wait(500);
  const dudBefore = await page.evaluate(async () => (await import('/src/ui/bridge.ts')).hud.get().dud);
  await press({ kick: true }, 60);
  const dud = await page.evaluate(async () => (await import('/src/ui/bridge.ts')).hud.get().dud);
  const wiggling = await page.$eval('.hud-keys .mk:nth-child(2) .mk-cap', el => el.getAnimations().length);

  // Headbutt glints; Takedown glints too, but draws no zone on the floor.
  await page.evaluate(() => { window.pixelforgePlay.player.controller.override = { headbutt: true }; });
  await wait(50);
  const headbutt = await marks();
  await page.evaluate(() => { window.pixelforgePlay.player.controller.override = {}; });
  await wait(1200);
  await page.evaluate(() => { window.pixelforgePlay.player.controller.override = { takedown: true }; });
  await wait(250);
  const takedown = await marks();
  await page.screenshot({ path: 'previews/fight-readable-takedown.png' });
  await page.evaluate(() => { window.pixelforgePlay.player.controller.override = {}; });
  await wait(1500);
  const spent = await marks();

  // Block: a shield on the side covered.
  await page.evaluate(() => { window.pixelforgePlay.player.controller.override = { block: true }; });
  await wait(200);
  const block = await marks();
  await page.screenshot({ path: 'previews/fight-readable-block.png' });
  await page.evaluate(() => { window.pixelforgePlay.player.controller.override = {}; });
  await wait(200);
  const released = await marks();

  console.log(JSON.stringify({ caps, start, kickCap, dudBefore, dud, wiggling, headbutt, takedown, spent, block, released, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(caps.map(c => c.key), ['C', 'X', 'Z', 'V', 'S', 'Shift'], 'a keycap per move, each with its key');
  assert.ok(caps.every(c => !/[a-z]{3}/i.test(c.text.replace(c.key ?? '', ''))), 'no move names printed by the keys');
  assert.deepEqual(start.fighters[0], { mine: true, superReady: true, block: null }, 'my ring, with the Super-ready ring');
  assert.ok(start.floorDrawn > 0, 'rings drawn on the floor');
  assert.match(kickCap, /is-cooldown/, 'the kick cap goes down while it cools');
  assert.equal(dudBefore, null);
  assert.equal(dud?.move, 'kick', 'kicking again while it cools is a dud');
  assert.ok(wiggling > 0, 'the kick cap wiggles');
  assert.deepEqual(headbutt.telegraphs, [{ move: 'headbutt', glint: true }], 'headbutt glints');
  assert.deepEqual(takedown.telegraphs, [{ move: 'takedown', glint: true }], 'takedown glints');
  assert.equal(takedown.floorDrawn, spent.floorDrawn, 'takedown keeps its hit zone hidden (only the glint warns)');
  assert.equal(spent.telegraphs.length, 0, 'the telegraph ends with the wind-up');
  assert.equal(spent.fighters[0].superReady, false, 'no Super ring while it cools');
  assert.equal(block.fighters[0].block, 'right');
  assert.ok(block.shield, 'a shield while blocking');
  assert.ok(!released.shield, 'no shield after');
  console.log('passed');
} finally { await browser.close(); }
