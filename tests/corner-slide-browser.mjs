// Run against npm run dev. Uses installed Playwright, or PLAYWRIGHT_MODULE from a bundled runtime.
// Walks the player into the corners of real solid props in brock3: clipping a corner by a few pixels
// slides around it, hitting a wall head-on still stops you.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const character = process.env.CHARACTER ?? 'titus';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } }), errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173'}/?level=brock3&character=${character}`);
  await page.waitForFunction(() => window.pixelforgePlay?.state().level === 'brock3');
  const results = await page.evaluate(() => {
    const play = window.pixelforgePlay; play.freeze();
    const scene = play.scene, player = scene.level.player, body = player.body;
    const layers = Object.values(scene.level.layers);
    const solids = scene.level.props.filter((p) => p.body?.enable);
    const blocked = (x, y, w, h, except) =>
      layers.some((l) => l.getTilesWithinWorldXY(x, y, w, h, { isColliding: true }).length) ||
      solids.some((p) => p !== except && x < p.body.right && p.body.x < x + w && y < p.body.bottom && p.body.y < y + h);
    const place = (x, y) => {   // body's top-left at (x, y)
      const ox = body.x - player.x, oy = body.y - player.y;
      body.reset(x - ox, y - oy);
      player.controller.stunnedUntil = 0; player.controller.busy = null;
      if (player.combat) { player.combat.rules.attack = null; player.combat.rules.block = null; }
      play.step(17, {});
    };
    const { width: w, height: h } = body;
    const reachX = Math.max(6, Math.round(w * 0.45)), reachY = Math.max(6, Math.round(h * 0.45));
    // walk `dir` toward prop p from `gap` px away, lined up with one of its corners and clipping it by
    // `clip` px across the walk (down/right graze the top-left corner, up/left the bottom-right one)
    const gap = 6, cases = [], perDir = {};
    const setups = (b) => [
      { dir: 'down', x: (c) => b.x - w + c, y: () => b.y - h - gap, area: [b.x - 2 * w - 4, b.y - h - gap - 2, 3 * w + 8, h + gap + 2] },
      { dir: 'up', x: (c) => b.right - c, y: () => b.bottom + gap, area: [b.right - w - 4, b.bottom, 3 * w + 8, h + gap + 2] },
      { dir: 'right', x: () => b.x - w - gap, y: (c) => b.y - h + c, area: [b.x - w - gap - 2, b.y - 2 * h - 4, w + gap + 2, 3 * h + 8] },
      { dir: 'left', x: () => b.right + gap, y: (c) => b.bottom - c, area: [b.right, b.bottom - h - 4, w + gap + 2, 3 * h + 8] },
    ];
    for (const p of solids) {
      const b = p.body;
      for (const s of setups(b)) {
        if ((perDir[s.dir] ?? 0) >= 2) continue;
        // the approach and the slide must be clear of everything (only this prop ahead)
        if (blocked(...s.area, p)) continue;
        const vertical = s.dir === 'down' || s.dir === 'up', reach = vertical ? reachX : reachY;
        // the corner's far side must be clear too, or there's nowhere to slide to
        const pastCorner = { down: [b.x - w - 2, b.y, w + 2, b.height], up: [b.right, b.y, w + 2, b.height],
                             right: [b.x, b.y - h - 2, b.width, h + 2], left: [b.x, b.bottom, b.width, h + 2] }[s.dir];
        if (blocked(...pastCorner, p)) continue;
        perDir[s.dir] = (perDir[s.dir] ?? 0) + 1;
        for (const [label, clip] of [['clip 3px', 3], ['clip at reach', reach], ['clip past reach', reach + 2], ['head-on', vertical ? Math.min(w, b.width) : h]]) {
          const x = s.x(clip), y = s.y(clip);
          place(x, y);
          play.step(500, { [s.dir]: true });
          // past = walked on beyond the point where it would bump into the prop head-on
          const past = { down: body.y > b.y - h + 2, up: body.y < b.bottom - 2, right: body.x > b.x - w + 2, left: body.x < b.right - 2 }[s.dir];
          const inside = body.x < b.right && b.x < body.right && body.y < b.bottom && b.y < body.bottom;
          cases.push({ prop: p.pixelforgeObject?.prop, dir: s.dir, label, clip, past, inside,
                       body: [Math.round(body.x), Math.round(body.y)], start: [x, y] });
        }
      }
    }
    return { w, h, reachX, reachY, cases };
  });
  console.log(`feet box ${results.w}x${results.h}, reach ${results.reachX}px across a vertical walk, ${results.reachY}px across a horizontal one`);
  for (const c of results.cases) console.log(`${c.prop.padEnd(24)} ${c.dir.padEnd(5)} ${c.label.padEnd(16)} clip ${String(c.clip).padStart(2)}  ${c.past ? 'got past' : 'stopped '}  start ${c.start}  end ${c.body}`);
  assert.deepEqual(errors, []);
  for (const dir of ['down', 'up', 'right', 'left']) assert.ok(results.cases.some((c) => c.dir === dir), `found a prop to walk ${dir} into`);
  for (const c of results.cases) {
    assert.ok(!c.inside, `${c.prop} ${c.dir} ${c.label}: walked into the prop`);
    if (c.label.startsWith('clip 3') || c.label === 'clip at reach') assert.ok(c.past, `${c.prop} ${c.dir} ${c.label}: should slide around the corner`);
    else assert.ok(!c.past, `${c.prop} ${c.dir} ${c.label}: should stop`);
  }
  console.log('corner slide ok');
} finally {
  await browser.close();
}
