// Every fighter's hurt pose (hurt_<down|up|side>), played for the flinch after a hit: the head snaps back
// away from the hit, the upper body leans with it, and the arms swing out. It's built from each fighter's
// own layers, so it follows their art. Run: node scripts/build-hurt.mjs, then pixelforge export titus mason james.
import fs from 'node:fs';
const frame = (layers, duration) => ({ layers, duration });
const at = (from, offset) => offset[0] || offset[1] ? { from, offset } : from;
// Swing an arm around its shoulder by shearing it: each row below the shoulder slides `slope` px per row
// (negative = left). The shoulder stays attached and the edges become clean 2:1 or 3:1 steps.
function swing(grid, keep, slope) {
  const rows = grid.map(r => r.map((c, x) => keep(x) ? c : '.'));
  const top = rows.findIndex(r => r.some(c => c !== '.'));
  const out = rows.map(r => r.map(() => '.'));
  rows.forEach((r, y) => {
    const shift = Math.round(Math.max(0, y - top - 3) * slope);
    r.forEach((c, x) => { if (c !== '.' && out[y][x + shift] !== undefined) out[y][x + shift] = c; });
  });
  return out;
}
for (const id of ['titus', 'mason', 'james']) {
  const dir = 'sprites/' + id, spec = JSON.parse(fs.readFileSync(dir + '/sprite.json', 'utf8'));
  const read = name => fs.readFileSync(dir + '/frames/' + name + '.txt', 'utf8').trimEnd().split(/\r?\n/).map(r => [...r]);
  const save = (name, g) => { fs.writeFileSync(dir + '/frames/' + name + '.txt', g.map(r => r.join('')).join('\n') + '\n'); return name; };
  for (const [facing, view] of [['down', 'front'], ['up', 'back'], ['side', 'side']]) {
    const side = view === 'side';
    // "Back" is away from the attacker, who stands where the fighter faces: up the screen for the
    // front view, down it for the back view, left for the side view (flipped at runtime for left).
    const back = side ? [-1, 0] : view === 'front' ? [0, -1] : [0, 1];
    const scale = n => [back[0] * n, back[1] * n];
    // Front and back: each arm swings out to its own side. Side: the one visible arm swings back.
    const arms = side ? read(view + '_arm') : read(view + '_arms');
    const armsAt = (tag, slope) => side
      ? [save(`hurt_${view}_arm_${tag}`, swing(arms, () => true, -slope))]
      : [save(`hurt_${view}_arm_l_${tag}`, swing(arms, x => x < 32, -slope)),
         save(`hurt_${view}_arm_r_${tag}`, swing(arms, x => x >= 32, slope))];
    const pose = (lean, snap, tag, slope) => {
      const flung = armsAt(tag, slope).map(name => at(name, lean));
      return [view + '_shadow', view + '_legs_stand', at(view + '_torso', lean), ...flung, at(view + '_head', snap)];
    };
    // A sharp snap (head 3px back, arms flung wide), then a held recoil the flinch plays out on.
    spec.animations['hurt_' + facing] = { loop: false, frames: [
      frame(pose(scale(1), scale(3), 'snap', side ? 0.6 : 0.4), 90),
      frame(pose(scale(1), scale(2), 'recoil', side ? 0.35 : 0.2), 260),
    ] };
  }
  const reactions = spec.groups?.Reactions;
  if (reactions && !reactions.includes('hurt_*')) reactions.unshift('hurt_*');
  fs.writeFileSync(dir + '/sprite.json', JSON.stringify(spec, null, id === 'james' ? 2 : 1) + '\n');
}
console.log('Built hurt poses for every fighter.');
