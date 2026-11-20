import { characterStats } from '../characters.js';
import { wallBetween } from './walls.js';

// frames = [windup, active, return, recovery] ms; the build scripts bake them into both sprites'
// animations, so a frames change needs `node scripts/build-titus-combat.mjs`, the Mason patch and a re-export.
// lunge = px/s added toward the attack's facing through windup+active, closing the gap mid-swing.
export const ATTACKS = Object.freeze({
  punch: { key: 'C', damage: 4, cooldown: 300, frames: [70, 90, 60, 100], reach: 34, width: 20, lunge: 60, knockback: 25, stagger: 0 },
  kick: { key: 'X', damage: 9, cooldown: 5000, frames: [110, 120, 80, 150], reach: 50, width: 22, lunge: 80, knockback: 45, stagger: 0 },
  headbutt: { key: 'Z', damage: 10, cooldown: 10000, frames: [150, 110, 90, 200], reach: 30, width: 20, lunge: 110, knockback: 140, stagger: 350 },
  takedown: { key: 'S', character: 'titus', damage: 25, cooldown: 20000, frames: [500, 100, 180, 320], reach: 24, width: 10, maxTargets: 1, speed: 0, knockback: 45, stagger: 1500, knockdown: 1500 },
});
// Positions are body centres, but people are hit on their body, not at their centre: every
// attack zone is credited the defender's half-width on all sides.
export const BODY = 9;
// Preserve attack geometry, animation timing and special moves; only basic balance varies.
export function characterAttack(character, name) {
  const base = ATTACKS[name], stats = characterStats(character);
  if (!['punch', 'kick', 'headbutt'].includes(name)) return base;
  return { ...base, damage: stats[name], cooldown: stats[name + 'Cooldown'] ?? base.cooldown };
}
export const BLOCK = Object.freeze({ duration: 3000, cooldown: 1000, reduction: 0.75, speed: 0.5 });
export const REGEN = Object.freeze({ delay: 45000, perSecond: 2 });
export const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });

// The animation key for an attack. Facing up or down, every other punch (odd `count`) is thrown
// with the other hand, if the character has it (`<char>_punch_alt_<dir>`).
export function attackAnim(char, name, facing, count, exists) {
  const dir = facing === 'left' || facing === 'right' ? 'side' : facing;
  const alt = `${char}_${name}_alt_${dir}`;
  return name === 'punch' && dir !== 'side' && count % 2 === 1 && exists(alt) ? alt : `${char}_${name}_${dir}`;
}

export function directionTo(dx, dy) {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// Narrow t in [lo, hi] to where v0 - t*dv stays inside [min, max]; false once it's empty.
function clip(range, v0, dv, min, max) {
  if (!dv) return v0 >= min && v0 <= max;
  const a = (v0 - max) / dv, b = (v0 - min) / dv;
  range[0] = Math.max(range[0], Math.min(a, b));
  range[1] = Math.min(range[1], Math.max(a, b));
  return range[0] <= range[1];
}

// Is the target in the zone of an attacker standing anywhere on the segment from a to b?
function zoneAlong(a, b, target, fx, fy, spec) {
  const dx = target.x - a.x, dy = target.y - a.y, mx = b.x - a.x, my = b.y - a.y;
  const width = (spec.width ?? 18) + BODY, range = [0, 1];
  return clip(range, dx * fx + dy * fy, mx * fx + my * fy, -BODY, spec.reach + BODY)
    && clip(range, dx * fy - dy * fx, mx * fy - my * fx, -width, width);
}

// Share target geometry and nearest-first selection between local play and the host.
// `path` is where the attacker has been since the swing started (oldest first). A lunge can carry
// the attacker through someone before the strike comes out, so the zone sweeps that whole path:
// anyone the swing passed over is hit, not only whoever is still in front at the active frame.
// `walls` (walls.js) is the level's wall grid: nobody is hit through a wall, from any point on the path.
export function attackTargets(source, targets, facing, spec, path = [], walls = null) {
  const [fx, fy] = DIRECTIONS[facing], points = [...path, source];
  return targets.filter(target => points.some((point, i) => zoneAlong(points[i - 1] ?? point, point, target, fx, fy, spec)
      && !wallBetween(walls, point, target)))
    .sort((a, b) => Math.hypot(a.x-source.x, a.y-source.y) - Math.hypot(b.x-source.x, b.y-source.y));
}

// Record the attacker's position for attackTargets' path, skipping samples where it stood still.
export function extendPath(path, { x, y }) {
  const last = path[path.length - 1];
  if (!last || last.x !== x || last.y !== y) path.push({ x, y });
  return path;
}

// Continuous game time, including time spent moving between levels. A blocked hit still resets regen.
export class HealthPool {
  constructor(onChange = () => {}, max = 100) { this.max = max; this.value = max; this.quiet = 0; this.onChange = onChange; }
  // Preserve remaining health percentage when switching fighters; doors do not refill HP.
  setMax(max) {
    if (max === this.max) return;
    this.value = Math.min(max, this.value / this.max * max);
    this.max = max;
    this.onChange(this.value);
  }
  reset() { this.value = this.max; this.quiet = 0; for (const name of Object.keys(this.readyAt ?? {})) delete this.readyAt[name]; this.onChange(this.value); }
  take(amount) {
    if (amount <= 0 || this.value <= 0) return 0;
    const before = this.value;
    this.value = Math.max(0, this.value - amount);
    this.quiet = 0;
    this.onChange(this.value);
    return before - this.value;
  }
  update(delta) {
    const before = Math.max(0, this.quiet - REGEN.delay);
    this.quiet += delta;
    const healingTime = Math.max(0, this.quiet - REGEN.delay) - before;
    if (healingTime && this.value > 0 && this.value < this.max) {
      this.value = Math.min(this.max, this.value + healingTime * REGEN.perSecond / 1000);
      this.onChange(this.value);
    }
  }
}

export class CombatRules {
  constructor(health = new HealthPool(), character = 'titus') {
    this.health = health;
    this.setCharacter(character);
    this.attack = null;
    this.block = null;
    this.readyAt = health.readyAt ??= {};
    this.blockReadyAt = 0;
    this.staggerUntil = 0;
    this.knockedDownUntil = 0;
    this.previous = {};
  }
  setCharacter(character) {
    this.character = character;
    this.health.setMax(characterStats(character).health);
  }
  attackSpec(name) { return characterAttack(this.character, name); }
  update(now, input, facing) {
    if (this.block && (!input.block || now >= this.block.until)) this.endBlock(now);
    const available = !this.attack && !this.block && now >= this.staggerUntil && this.health.value > 0;
    if (available && input.block && !this.previous.block && now >= this.blockReadyAt) {
      this.block = { facing, until: now + characterStats(this.character).blockDuration };
    } else if (available) {
      for (const name of Object.keys(ATTACKS)) {
        const spec = this.attackSpec(name);
        if (spec.character && spec.character !== this.character) continue;
        if (input[name] && !this.previous[name] && now >= (this.readyAt[name] ?? 0)) {
          this.attack = { name, facing, start: now };
          this.readyAt[name] = now + spec.cooldown;
          break;
        }
      }
    }
    // Inputs pressed during another animation are consumed, never queued or auto-repeated.
    this.previous = { ...input };
  }
  finishAttack() { this.attack = null; }
  endBlock(now) { this.block = null; this.blockReadyAt = now + BLOCK.cooldown; }
  receive(spec, incomingSide, now) {
    const blocked = !!this.block && now < this.block.until && this.block.facing === incomingSide;
    const damage = this.health.take(spec.damage * (blocked ? 1 - BLOCK.reduction : 1));
    const stagger = blocked ? 0 : spec.stagger;
    const knockdown = blocked ? 0 : (spec.knockdown ?? 0);
    if (damage && stagger) {
      this.attack = null;
      if (this.block) this.endBlock(now);
      this.staggerUntil = Math.max(this.staggerUntil, now + stagger);
      this.knockedDownUntil = Math.max(this.knockedDownUntil, now + knockdown);
      if (knockdown) this.knockdownFacing = incomingSide;
    }
    return { damage, blocked, stagger, knockdown, knockdownFacing: knockdown ? incomingSide : null, knockback: spec.knockback * (blocked ? 0.25 : 1) };
  }
}
