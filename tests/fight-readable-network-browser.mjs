// Run against npm run dev, two players (host James, guest Mason):
//   the guest's attacks carry the host time its screen shows (`seen`) and the host rewinds to it;
//   the guest's own punch is felt the moment it visibly lands, once, not again when the host confirms it;
//   each screen draws the other's red ring (and Super ring), their block's shield and their heavy wind-up;
//   a Bellow from off the guest's (small) screen flashes an arrow at the edge pointing at the host.
// Screenshots go to previews/fight-readable-net-*.png.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', errors = [], pages = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('previews', { recursive: true });
try {
  // The guest's screen is small (200x150 game pixels at zoom 2), so a Bellow can reach it from off screen.
  for (const [character, viewport] of [['james', { width: 1280, height: 760 }], ['mason', { width: 400, height: 300 }]]) {
    const page = await (await browser.newContext({ viewport })).newPage();
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
    const s = window.pixelforgePlay.scene, me = window.pixelforgePlay.player;
    window.lands = []; window.commands = []; window.telegraphs = [];
    const land = s.hitFeel.land.bind(s.hitFeel), cmd = brockNet.combatCommand.bind(brockNet), tg = s.marks.telegraph.bind(s.marks);
    s.hitFeel.land = (a, v, move, result, o) => { land(a, v, move, result, o); window.lands.push({ move, mine: a === me, at: performance.now() }); };
    brockNet.combatCommand = (action, facing, seen) => { window.commands.push({ action, seen, now: performance.now(), snap: brockNet.snapTime }); return cmd(action, facing, seen); };
    s.marks.telegraph = (sprite, move, ...rest) => { window.telegraphs.push({ move, remote: sprite !== me }); return tg(sprite, move, ...rest); };
    window.hits = [];
    brockNet.on('combat', ({ hits }) => { for (const h of hits) window.hits.push({ ...h, at: performance.now() }); });
  });
  const place = async (gap, dy = 0) => {
    await host.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200, 650); p.controller.facing = 'right'; });
    await guest.evaluate(([gap, dy]) => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200 + gap, 650 + dy); p.controller.facing = 'left'; }, [gap, dy]);
    await wait(500);
    for (const page of pages) await page.evaluate(() => { window.lands = []; window.commands = []; window.telegraphs = []; window.hits = []; });
  };
  const hold = (page, keys) => page.evaluate(k => { window.pixelforgePlay.player.controller.override = k; }, keys);
  const press = async (page, keys, ms = 120) => { await hold(page, keys); await wait(ms); await hold(page, {}); };

  // Rings and Super rings: each screen marks the other player red, with their Super ready.
  const marked = page => page.evaluate(() => window.pixelforgePlay.scene.marks.fighters().map(f => ({ mine: f.mine, superReady: f.superReady, block: f.block })));
  await place(24);
  const rings = { host: await marked(host), guest: await marked(guest) };

  // The guest punches the host: the command says what moment it saw, the host rewinds to it, and the guest
  // feels the hit once, before the host's answer arrives.
  await press(guest, { punch: true });
  await guest.waitForFunction(() => window.hits.some(h => h.move === 'punch'));
  await wait(400);
  const punch = await guest.evaluate(() => ({ commands: window.commands, lands: window.lands, hits: window.hits.filter(h => h.move === 'punch'),
    snap: brockNet.snapTime, predicted: [...window.pixelforgePlay.scene.predicted.keys()] }));
  const hostHealth = await host.evaluate(() => window.pixelforgePlay.scene.combat.rules.health.value);

  // The guest blocks: the host's screen draws a shield on them.
  await hold(guest, { block: true });
  await wait(400);
  const blockSeen = await host.evaluate(() => { const f = window.pixelforgePlay.scene.marks.fighters().find(f => !f.mine); return f && { block: f.block, superReady: f.superReady }; });
  const shieldShown = await host.evaluate(() => [...window.pixelforgePlay.scene.marks.shields.values()].some(([g]) => g.visible));
  await host.screenshot({ path: 'previews/fight-readable-net-block.png' });
  await hold(guest, {});
  await wait(1200);

  // The host Bellows from 150 px away: off the guest's small screen. The guest sees an arrow at the edge,
  // and the host's own screen telegraphs it (and the guest's, as a remote wind-up).
  await place(150);
  await hold(host, { bellow: true });
  await wait(200);
  await host.screenshot({ path: 'previews/fight-readable-net-bellow.png' });
  await hold(host, {});
  await guest.waitForFunction(() => window.hits.some(h => h.move === 'bellow'), null, { timeout: 4000 });
  await wait(100);
  const arrow = await guest.evaluate(async () => ({ view: (({ x, y, width, height }) => ({ x, y, width, height }))(window.pixelforgePlay.scene.cameras.main.worldView),
    me: [window.pixelforgePlay.player.x, window.pixelforgePlay.player.y], other: window.pixelforgePlay.scene.remotes.sprites().map(s => [s.x, s.y, s.visible]), state: (await import('/src/ui/bridge.ts')).hud.get().hitArrow, shown: document.querySelectorAll('.hit-arrow').length }));
  await guest.screenshot({ path: 'previews/fight-readable-net-arrow.png' });
  const bellowTelegraphs = { host: await host.evaluate(() => window.telegraphs), guest: await guest.evaluate(() => window.telegraphs) };

  console.log(JSON.stringify({ sent: punch.commands, arrow }, null, 1));
  console.log(JSON.stringify({ rings, punch, hostHealth, blockSeen, shieldShown, arrow, bellowTelegraphs, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(rings.host.map(f => f.mine), [true, false]);
  assert.deepEqual(rings.guest.map(f => f.mine), [true, false]);
  assert.ok(rings.guest[1].superReady && rings.host[1].superReady, 'each sees the other\'s Super ready');
  const sent = punch.commands.find(c => c.action === 'punch');
  assert.ok(Number.isFinite(sent?.seen), 'the punch carries the host time the guest saw');
  assert.ok(sent.snap - sent.seen >= 50 && sent.snap - sent.seen <= 250, `about DELAY_MS behind the newest snapshot (${sent.snap - sent.seen} ms)`);
  assert.equal(punch.hits.length, 1);
  assert.ok(hostHealth < 200, 'the host (James, 200 HP) took the punch');
  const felt = punch.lands.filter(l => l.move === 'punch' && l.mine);
  assert.equal(felt.length, 1, 'the guest felt its punch once');
  assert.ok(felt[0].at < punch.hits[0].at, 'before the host\'s answer arrived');
  assert.deepEqual(punch.predicted, [], 'the confirmation matched the prediction');
  assert.equal(blockSeen?.block, 'left', 'the host sees the guest blocking toward it');
  assert.ok(shieldShown, 'with a shield drawn');
  assert.ok(arrow.state && Math.abs(Math.abs(arrow.state.angle) - Math.PI) < 0.3, `the arrow points left, at the host (${arrow.state?.angle})`);
  assert.equal(arrow.shown, 1);
  assert.ok(bellowTelegraphs.host.some(t => t.move === 'bellow' && !t.remote), 'the host\'s Bellow telegraphs on its screen');
  assert.ok(bellowTelegraphs.guest.some(t => t.move === 'bellow' && t.remote), 'and on the guest\'s, as a remote wind-up');
  console.log('passed');
} finally { await browser.close(); }
