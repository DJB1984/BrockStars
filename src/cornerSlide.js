// Corner grace for top-down walking: when the player walks straight into a wall they only clip by a few
// pixels (a corner of a desk, the edge of a shower stall), they slide sideways around it instead of
// stopping dead. Like Zelda, it only kicks in for straight (non-diagonal) walking at normal speed, so
// attacks, lunges, blocking and knockback are left alone.
//
//   enableCornerSlide(player, { layers: Object.values(level.layers), props: level.props });
//
// grace: how far it will nudge the player, as a fraction of the feet box's size across the walk
// (0.45 of a 20px-wide box = up to 9px), and never less than 6px, so the thin 8px-tall feet box still
// gets some grace walking sideways. Past that the wall counts as head-on and stops you as before.
export function enableCornerSlide(sprite, { layers = [], props = [], grace = 0.45 } = {}) {
  const c = sprite.controller, scene = sprite.scene;
  const update = c.update.bind(c);
  const EPS = 0.01;

  // Does anything the player collides with overlap this rectangle?
  const solid = (x, y, w, h) => {
    x += EPS; y += EPS; w -= 2 * EPS; h -= 2 * EPS;
    const bounds = scene.physics.world.bounds;
    if (x < bounds.x || y < bounds.y || x + w > bounds.right || y + h > bounds.bottom) return true;
    for (const layer of layers) {
      if (layer.getTilesWithinWorldXY(x, y, w, h, { isColliding: true }).length) return true;
    }
    for (const p of props) {
      const b = p.body;
      if (b?.enable && p.active && x < b.x + b.width && b.x < x + w && y < b.y + b.height && b.y < y + h) return true;
    }
    return false;
  };

  c.update = (time) => {
    update(time);
    const body = sprite.body;
    if (!sprite.active || !body || scene.pixelforgeStopped || c.busy || time < (c.stunnedUntil ?? 0)) return;
    const speed = c.opts.speed, { x: vx, y: vy } = body.velocity;
    // only a plain straight walk: one axis at walking speed, the other still
    const horizontal = Math.abs(Math.abs(vx) - speed) < 0.5 && vy === 0;
    const vertical = Math.abs(Math.abs(vy) - speed) < 0.5 && vx === 0;
    if (!horizontal && !vertical) return;
    const fx = horizontal ? Math.sign(vx) : 0, fy = vertical ? Math.sign(vy) : 0;   // forward
    const px = fy ? 1 : 0, py = fx ? 1 : 0;                                         // across
    const { x, y, width: w, height: h } = body;
    if (!solid(x + fx, y + fy, w, h)) return;   // nothing ahead: walking already works
    const reach = Math.max(6, Math.round((px ? w : h) * grace));
    // smallest sideways shift (either way) whose sweep is clear and that has a clear step ahead
    const found = [];
    for (const side of [-1, 1]) {
      for (let k = 1; k <= reach; k++) {
        const sx = px * side * k, sy = py * side * k;
        // the whole strip the body sweeps through on the way there must be free
        if (solid(Math.min(x, x + sx), Math.min(y, y + sy), w + Math.abs(sx), h + Math.abs(sy))) break;
        if (!solid(x + sx + fx, y + sy + fy, w, h)) { found.push({ side, k }); break; }
      }
    }
    if (!found.length) return;
    found.sort((a, b) => a.k - b.k);
    if (found.length === 2 && found[0].k === found[1].k) return;   // dead centre on a post: no favourite side
    const { side, k } = found[0];
    // slide across at walking speed, but don't overshoot the gap this frame; hold still along the wall
    // (moving into it at the same time would let Arcade push the body back out sideways)
    const step = Math.min(speed, k * 60);
    body.setVelocity(px * side * step, py * side * step);
  };
}
