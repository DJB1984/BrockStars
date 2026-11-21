// The hit effects, drawn from a few shapes so they stay symmetric about their centre:
//   fx_hit        a punch or kick connecting: a white star that bursts out and burns down to amber
//   fx_hit_heavy  headbutt and the Supers: bigger, with a shock ring
//   fx_block      a blocked hit: a cyan ring that breaks into blue sparks
//   fx_swish      a swing that missed: a pale arc of air, drawn facing right (rotated in the game)
//   fx_glint      a heavy move winding up (headbutt, the Supers): a thin white star that flares on the head
// Run: node scripts/build-hit-fx.mjs, then pixelforge export fx_hit fx_hit_heavy fx_block fx_swish fx_glint.
import fs from 'node:fs';

function canvas(W, H) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y, c) => { if (g[y]?.[x] !== undefined) g[y][x] = c; };
  // Paint (x, y) in the lower-right quarter and its three mirror images.
  const put4 = (x, y, c) => { set(x, y, c); set(W - 1 - x, y, c); set(x, H - 1 - y, c); set(W - 1 - x, H - 1 - y, c); };
  const cx = W / 2, cy = H / 2;
  const ramp = (colors, t) => colors[Math.min(colors.length - 1, Math.floor(t * colors.length))];
  return {
    g,
    // A filled disc of radius r (and a hollow one with `inner`).
    disc(r, c, inner = -1) {
      for (let y = cy; y < H; y++) for (let x = cx; x < W; x++) {
        const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
        if (d <= r && d > inner) put4(x, y, c);
      }
    },
    // The four straight rays from r0 to r1, `half` px either side of the axis, coloured along their length.
    cross(r0, r1, colors, half = 1) {
      for (let s = Math.floor(r0); s < r1; s++) for (let w = 0; w < half; w++) {
        const c = ramp(colors, (s - r0) / Math.max(1, r1 - r0));
        put4(cx + s, cy + w, c); put4(cx + w, cy + s, c);
      }
    },
    // The four diagonal rays, one pixel wide.
    diagonals(r0, r1, colors) {
      for (let s = Math.floor(r0); s < r1; s++) put4(cx + s, cy + s, ramp(colors, (s - r0) / Math.max(1, r1 - r0)));
    },
    text: () => g.map(r => r.join('')).join('\n') + '\n',
  };
}

// A crescent of air for the swish: the band between two circles, facing right, as wide as `sweep`.
function swish(W, H, outer, thick, sweep, colors) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const cx = W / 2 - outer * 0.55, cy = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (Math.abs(a) > sweep || d > outer || d < outer - thick * Math.cos(a / sweep * Math.PI / 2)) continue;
    // Brightest on the leading (outer) edge, thinning to its tips.
    const edge = (outer - d) / thick;
    g[y][x] = colors[Math.min(colors.length - 1, Math.floor(edge * colors.length))];
  }
  return g.map(r => r.join('')).join('\n') + '\n';
}

const sprites = {
  fx_hit: {
    palette: { w: 'white', y: 'yellow', a: 'amber', o: 'orange' },
    frames: [
      [c => { c.disc(2.6, 'y'); c.disc(1.8, 'w'); c.cross(0, 4, ['w', 'w', 'y']); }, 40],
      [c => { c.disc(2.2, 'w'); c.cross(0, 8, ['w', 'w', 'y', 'a']); c.diagonals(2, 6, ['y', 'y', 'a']); }, 50],
      [c => { c.cross(4, 8, ['y', 'a', 'a']); c.diagonals(4, 7, ['a', 'o']); }, 50],
      [c => { c.cross(6, 8, ['o']); c.diagonals(5, 7, ['o']); }, 60],
    ],
  },
  fx_hit_heavy: {
    palette: { w: 'white', y: 'yellow', a: 'amber', o: 'orange', r: 'red' },
    frames: [
      [c => { c.disc(5, 'y'); c.disc(3.6, 'w'); c.cross(0, 8, ['w', 'w', 'y'], 2); }, 40],
      [c => { c.disc(4.4, 'w'); c.cross(0, 16, ['w', 'w', 'y', 'y', 'a'], 2); c.diagonals(4, 12, ['y', 'y', 'a']); c.disc(10, 'y', 9); }, 60],
      [c => { c.disc(13, 'a', 12); c.cross(8, 16, ['y', 'a', 'a', 'o'], 2); c.diagonals(8, 13, ['a', 'o']); }, 60],
      [c => { c.disc(15, 'o', 14.2); c.cross(12, 16, ['o', 'r']); c.diagonals(10, 13, ['o', 'r']); }, 70],
    ],
  },
  fx_block: {
    palette: { w: 'white', c: 'cyan', b: 'blue', n: 'navy' },
    frames: [
      [c => { c.disc(3.2, 'c'); c.disc(2, 'w'); }, 40],
      [c => { c.disc(5.4, 'c', 4.2); c.disc(4.2, 'w', 3.2); c.diagonals(4, 7, ['w', 'c']); }, 50],
      [c => { c.disc(6.6, 'b', 5.6); c.diagonals(5, 8, ['c', 'b']); }, 50],
      [c => { c.diagonals(6, 8, ['n']); }, 60],
    ],
  },
  // Longer and thinner than a hit's star, and white, not amber: a warning, not a contact. One pixel wide, so
  // it's drawn on an odd canvas (15x15) around its middle pixel rather than with the mirrored helpers.
  fx_glint: {
    palette: { w: 'white', y: 'yellow' },
    frames: [
      [c => glint(c, 2, 0, 'w'), 50],
      [c => glint(c, 7, 2, 'w'), 80],
      [c => glint(c, 5, 1, 'w'), 80],
      [c => glint(c, 2, 0, 'y'), 60],
    ],
  },
};

// A star `arm` pixels long each way (its tips yellow), with `diag` pixels of diagonal around the middle.
function glint(c, arm, diag, color) {
  const m = (c.g.length - 1) / 2, set = (x, y, k) => { c.g[y][x] = k; };
  for (let s = 0; s < arm; s++) {
    const k = s >= arm - 1 && arm > 3 ? 'y' : color;
    for (const [x, y] of [[m + s, m], [m - s, m], [m, m + s], [m, m - s]]) set(x, y, k);
  }
  for (let s = 1; s <= diag; s++) for (const [x, y] of [[m + s, m + s], [m - s, m + s], [m + s, m - s], [m - s, m - s]]) set(x, y, color);
}

for (const [name, spec] of Object.entries(sprites)) {
  const dir = `sprites/${name}`, json = JSON.parse(fs.readFileSync(`${dir}/sprite.json`, 'utf8'));
  const [W, H] = json.size;
  for (const f of fs.readdirSync(`${dir}/frames`)) fs.unlinkSync(`${dir}/frames/${f}`);
  json.palette = spec.palette;
  json.animations = { play: { frames: spec.frames.map(([draw, duration], i) => {
    const c = canvas(W, H);
    draw(c);
    fs.writeFileSync(`${dir}/frames/fx_${i}.txt`, c.text());
    return { from: `fx_${i}`, duration };
  }) } };
  fs.writeFileSync(`${dir}/sprite.json`, JSON.stringify(json, null, 2) + '\n');
}

{
  const dir = 'sprites/fx_swish', json = JSON.parse(fs.readFileSync(`${dir}/sprite.json`, 'utf8'));
  const [W, H] = json.size;
  for (const f of fs.readdirSync(`${dir}/frames`)) fs.unlinkSync(`${dir}/frames/${f}`);
  json.palette = { w: 'white', l: 'light_gray', g: 'gray' };
  const frames = [[0.7, 3, ['w', 'l']], [1.15, 4, ['w', 'l', 'l']], [1.25, 3, ['l', 'g']], [1.3, 2, ['g']]];
  json.animations = { play: { frames: frames.map(([sweep, thick, colors], i) => {
    fs.writeFileSync(`${dir}/frames/fx_${i}.txt`, swish(W, H, 11, thick, sweep, colors));
    return { from: `fx_${i}`, duration: i ? 50 : 40 };
  }) } };
  fs.writeFileSync(`${dir}/sprite.json`, JSON.stringify(json, null, 2) + '\n');
}
console.log('Built fx_hit, fx_hit_heavy, fx_block, fx_swish and fx_glint.');
