// Run against npm run dev. The match structure: a KO counts.
//   Solo: a KO lays you down and fades you out, and you're back at the spawn after KO.respawn, in the same scene.
//   Online (host Mason, guest Titus): Mason's punch KOs Titus. Both screens pop "KO!"; Titus lies down, fades,
//   and his screen dims with "KO'd by Mason"; the kill feed says "Mason KO'd Titus". Titus is back at the spawn
//   in the same scene, blinking, and a punch in his safe time does nothing. Mason leads: a crown on his name tag.
//   With a streak of 3, Mason's name tag shows it, small; Titus ending it earns 2 KOs and "Streak ended!".
//   The scores show on a held Tab and in the menu.
// Screenshots go to previews/match-*.png.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const baseUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173', errors = [], pages = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const KO = { respawn: 2000, safe: 1500 };
fs.mkdirSync('previews', { recursive: true });
const helpers = () => {
  window.words = () => window.pixelforgePlay.scene.children.list.filter(o => o.type === 'Text' && o.active && o.visible).map(o => o.text);
  window.seen = [];   // every word that popped, as it popped
  setInterval(() => { for (const w of window.words()) if (!window.seen.includes(w)) window.seen.push(w); }, 16);
  window.me = () => { const p = window.pixelforgePlay.player; return { x: p.x, y: p.y, alpha: p.alpha, anim: p.anims.currentAnim?.key, mark: p.__mark,
    health: window.pixelforgePlay.scene.combat.rules.health.value, koed: !!window.pixelforgePlay.scene.koed }; };
  window.text = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
};
try {
  // ---- solo ----------------------------------------------------------------------------------------
  const solo = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  solo.on('pageerror', e => errors.push(`solo: ${e.message}`));
  await solo.goto(`${baseUrl}/?solo&character=titus`);
  await solo.waitForFunction(() => window.pixelforgePlay?.player?.combat);
  await solo.evaluate(helpers);
  const spawn = await solo.evaluate(() => { const p = window.pixelforgePlay.player; p.__mark = 'same'; const at = { x: p.x, y: p.y }; p.body.reset(at.x + 60, at.y + 30); return at; });
  await wait(200);
  await solo.evaluate(() => window.pixelforgePlay.scene.combat.rules.health.take(999));
  await wait(450);
  const soloDown = await solo.evaluate(() => ({ ...window.me(), screen: window.text('.hud-ko .ko-title') }));
  await solo.screenshot({ path: 'previews/match-solo-ko.png' });
  await wait(KO.respawn);
  const soloBack = await solo.evaluate(() => window.me());
  assert.equal(soloDown.koed, true);
  assert.match(soloDown.anim, /knockdown/);
  assert.deepEqual(soloDown.screen, ["KO'd!"]);
  assert.equal(soloBack.koed, false);
  assert.equal(soloBack.mark, 'same', 'solo: respawned in the same scene');
  assert.deepEqual([Math.round(soloBack.x), Math.round(soloBack.y)], [Math.round(spawn.x), Math.round(spawn.y)]);
  assert.equal(soloBack.health, 125);
  await solo.close();
  console.log('Solo KO: down, dimmed, back at the spawn in the same scene');

  // ---- online --------------------------------------------------------------------------------------
  for (const character of ['mason', 'titus']) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
    page.on('pageerror', e => errors.push(`${character}: ${e.message}`));
    await page.goto(`${baseUrl}/?solo&character=${character}`);
    await page.waitForFunction(() => window.pixelforgePlay?.player?.combat);
    pages.push(page);
  }
  const [host, guest] = pages;
  const room = await host.evaluate(async () => { await brockNet.host({ name: 'Mason', level: 'brock3' }); return brockNet.room; });
  await guest.evaluate(async room => { await brockNet.join({ name: 'Titus', room }); }, room);
  for (const page of pages) await page.waitForFunction(() => brockNet.count === 2);
  for (const page of pages) await page.evaluate(helpers);
  const ids = { host: await host.evaluate(() => brockNet.id), guest: await guest.evaluate(() => brockNet.id) };
  const snap = () => host.evaluate(() => brockNet.combatState);
  const place = async (gap) => {
    await host.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200, 650); p.controller.facing = 'right'; });
    await guest.evaluate(gap => { const p = window.pixelforgePlay.player; p.controller.override = {}; p.body.reset(1200 + gap, 650); p.controller.facing = 'left'; }, gap);
    await wait(500);
  };
  const hold = (page, keys) => page.evaluate(k => { window.pixelforgePlay.player.controller.override = k; }, keys);
  const lastHit = (page, id) => page.evaluate(id => (window.pixelforgePlay.scene.combat.rules.health.value), id);

  // Titus one hit from a KO; Mason punches.
  await guest.evaluate(() => { const p = window.pixelforgePlay.player; p.__mark = 'same'; });
  const guestSpawn = await guest.evaluate(() => { const s = window.pixelforgePlay.scene, sp = s.level.spawns; const at = sp[s.spawnName] ?? sp.player ?? Object.values(sp)[0]; return { x: at.x, y: at.y }; });
  await host.evaluate(id => { const h = brockNet.arena.fighters.get(id).rules.health; h.take(h.value - 1); }, ids.guest);
  await guest.waitForFunction(() => window.pixelforgePlay.scene.combat.rules.health.value === 1);
  await place(24);
  for (const page of pages) await page.evaluate(() => { window.seen = []; });
  await hold(host, { punch: true });
  await guest.waitForFunction(() => !!window.pixelforgePlay.scene.koed, null, { timeout: 2000 });
  await hold(host, {});
  await wait(150);
  await host.screenshot({ path: 'previews/match-ko-host.png' });
  await wait(450);
  const down = await guest.evaluate(() => ({ ...window.me(), screen: window.text('.hud-ko .ko-title'), seen: window.seen }));
  await guest.screenshot({ path: 'previews/match-ko-guest.png' });
  const hostSeen = await host.evaluate(() => window.seen);
  const feed = { host: await host.evaluate(() => window.text('.kill-feed li')), guest: await guest.evaluate(() => window.text('.kill-feed li')) };
  const afterKo = await snap();
  assert.ok(hostSeen.includes('KO!'), `host saw KO!: ${hostSeen}`);
  assert.ok(down.seen.includes('KO!'), `guest saw KO!: ${down.seen}`);
  assert.match(down.anim, /^titus_knockdown_/);
  assert.deepEqual(down.screen, ["KO'd by Mason"]);
  assert.deepEqual(feed.host, ["Mason KO'd Titus"]);
  assert.deepEqual(feed.guest, ["Mason KO'd Titus"]);
  assert.deepEqual(afterKo.fighters[ids.host].score, { kos: 1, falls: 0, streak: 1 });
  assert.deepEqual(afterKo.fighters[ids.guest].score, { kos: 0, falls: 1, streak: 0 });
  assert.equal(afterKo.leader, ids.host);
  console.log('KO: KO! on both screens, knockdown pose, "KO\'d by Mason", feed line, credited to Mason');

  // Fading, then back at the spawn in the same scene, blinking and safe.
  await wait(500);
  const faded = await guest.evaluate(() => window.me().alpha);
  assert.ok(faded < 0.5, `faded out: alpha ${faded}`);
  await guest.waitForFunction(() => !window.pixelforgePlay.scene.koed, null, { timeout: 3000 });
  await wait(100);
  const back = await guest.evaluate(() => ({ ...window.me(), screen: window.text('.hud-ko') }));
  await guest.screenshot({ path: 'previews/match-respawn-guest.png' });
  assert.equal(back.mark, 'same', 'respawned in the same scene');
  assert.deepEqual([Math.round(back.x), Math.round(back.y)], [Math.round(guestSpawn.x), Math.round(guestSpawn.y)]);
  assert.equal(back.health, 125);
  assert.deepEqual(back.screen, []);
  const safe = (await snap()).fighters[ids.guest].safe;
  assert.ok(safe > 1000, `safe after respawn: ${safe}`);
  // A punch in the safe time does nothing.
  await host.evaluate(at => { const p = window.pixelforgePlay.player; p.body.reset(at.x - 24, at.y); p.controller.facing = 'right'; }, guestSpawn);
  await wait(250);
  await hold(host, { punch: true }); await wait(200); await hold(host, {});
  await wait(300);
  assert.equal((await snap()).fighters[ids.guest].health, 125, 'no damage while safe');
  const alphas = await guest.evaluate(async () => { const out = []; for (let i = 0; i < 12; i++) { out.push(window.pixelforgePlay.player.alpha); await new Promise(r => setTimeout(r, 30)); } return out; });
  assert.ok(new Set(alphas).size > 1, `blinking while safe: ${alphas}`);
  await wait(KO.safe);
  assert.equal((await snap()).fighters[ids.guest].safe, 0);
  console.log('Respawn: at the spawn, same scene, full health, blinking, untouchable for the safe time');

  // Mason leads: a crown over his name tag on Titus's screen.
  await place(40);
  const crown = await guest.evaluate(() => [...document.querySelectorAll('.name-tag')].map(t => ({ name: t.querySelector('.nt-name').textContent, crown: !t.querySelector('.nt-crown').hidden, streak: !t.querySelector('.nt-streak').hidden })));
  assert.deepEqual(crown, [{ name: 'Mason', crown: true, streak: false }]);

  // A streak of 3: small, after Mason's name. Then Titus ends it.
  await host.evaluate(id => { brockNet.arena.fighters.get(id).score.streak = 3; brockNet.arena.fighters.get(id).score.kos = 3; }, ids.host);
  await wait(300);
  const streakTag = await guest.evaluate(() => { const t = document.querySelector('.name-tag .nt-streak'); const r = t.getBoundingClientRect(), n = document.querySelector('.name-tag .nt-name').getBoundingClientRect();
    return { shown: !t.hidden, count: t.textContent, height: Math.round(r.height), nameHeight: Math.round(n.height), opacity: getComputedStyle(t).opacity }; });
  await guest.screenshot({ path: 'previews/match-streak-guest.png' });
  assert.equal(streakTag.shown, true);
  assert.equal(streakTag.count, '3');
  assert.ok(streakTag.height <= streakTag.nameHeight, `the streak is no taller than the name: ${JSON.stringify(streakTag)}`);
  await host.evaluate(id => { const h = brockNet.arena.fighters.get(id).rules.health; h.take(h.value - 1); }, ids.host);
  await host.waitForFunction(() => window.pixelforgePlay.scene.combat.rules.health.value === 1);
  await place(24);
  await guest.evaluate(() => { const p = window.pixelforgePlay.player; p.controller.facing = 'left'; });
  await hold(guest, { punch: true });
  await host.waitForFunction(() => !!window.pixelforgePlay.scene.koed, null, { timeout: 2000 });
  await hold(guest, {});
  await wait(300);
  const ended = { host: await host.evaluate(() => window.text('.kill-feed li')), guest: await guest.evaluate(() => window.text('.kill-feed li')) };
  await guest.screenshot({ path: 'previews/match-streak-ended-guest.png' });
  const endedSnap = await snap();
  assert.deepEqual(ended.guest.slice(0, 2), ['Streak ended! Titus +1', "Titus KO'd Mason"]);
  assert.deepEqual(ended.host.slice(0, 2), ['Streak ended! Titus +1', "Titus KO'd Mason"]);
  assert.deepEqual(endedSnap.fighters[ids.guest].score, { kos: 2, falls: 1, streak: 1 });
  assert.equal(endedSnap.leader, ids.host);   // Mason's 3 still lead
  console.log('Streak: shown small on the name tag; ending it is worth 2 KOs and "Streak ended!"');

  // The scores: on a held Tab, and in the menu.
  await wait(KO.respawn);
  await guest.keyboard.down('Tab');
  await wait(150);
  const board = await guest.evaluate(() => [...document.querySelectorAll('.hud-board tbody tr')].map(r => [...r.children].map(c => c.textContent.trim())));
  await guest.screenshot({ path: 'previews/match-board-guest.png' });
  await guest.keyboard.up('Tab');
  await wait(100);
  assert.deepEqual(board, [['Mason', '3', '1'], ['Titus', '2', '1']]);
  assert.equal(await guest.evaluate(() => !!document.querySelector('.hud-board')), false, 'Tab let go hides the scores');
  await guest.keyboard.press('Escape');
  await wait(300);
  const menuBoard = await guest.evaluate(() => [...document.querySelectorAll('.hud-dialog .board tbody tr')].length);
  await guest.screenshot({ path: 'previews/match-menu-guest.png' });
  await guest.keyboard.press('Escape');
  assert.equal(menuBoard, 2);
  console.log('Scores: on a held Tab and in the menu');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true }, null, 2));
} finally {
  for (const page of pages) await page.evaluate(() => window.brockNet?.leave()).catch(() => {});
  await browser.close();
}
