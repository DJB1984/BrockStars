// Run against npm run dev. Uses installed Playwright, or PLAYWRIGHT_MODULE from a bundled runtime.
// Walks the player each way in brock3 and checks, every frame, that the health bar over their head is
// centred on where the sprite is drawn that frame, not where it was the frame before.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const character = process.env.CHARACTER ?? 'mason';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } }), errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173'}/?level=brock3&character=${character}`);
  await page.waitForFunction(() => window.pixelforgePlay?.state().level === 'brock3');
  const result = await page.evaluate(() => {
    const play = window.pixelforgePlay; play.freeze();
    const scene = play.scene, player = scene.level.player, bar = scene.selfBar.g;
    const misses = [];
    let frames = 0;
    play.step(17, {});
    const above = bar.y - Math.round(player.y);   // standing still: how far over the feet the bar sits
    for (const dir of ['right', 'down', 'left', 'up']) {
      for (let i = 0; i < 30; i++) {
        play.step(17, { [dir]: true });
        frames++;
        // the bar is 22px wide, its left edge rounded: centred on the sprite's x as drawn this frame
        const dx = bar.x - Math.round(player.x - 11), dy = bar.y - Math.round(player.y) - above;
        if (dx || dy) misses.push({ dir, frame: i, dx, dy, x: player.x, y: player.y });
      }
    }
    return { frames, misses: misses.slice(0, 5), missCount: misses.length, moved: player.body.speed };
  });
  assert.equal(result.missCount, 0, `bar off-centre on ${result.missCount}/${result.frames} frames: ${JSON.stringify(result.misses)}`);
  assert.deepEqual(errors, []);
  console.log(`ok: head bar centred on ${character} for all ${result.frames} walking frames`);
} finally {
  await browser.close();
}
