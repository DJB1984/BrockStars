import { characterStats } from '../characters.js';
import { wallBetween } from './walls.js';

// frames = [windup, active, return, recovery] ms; the build scripts bake them into both sprites'
// animations; rebuild Grapple with scripts/build-mason-grapple.mjs and re-export after timing changes.
// lunge = px/s added toward the attack's facing through windup+active, closing the gap mid-swing.
// stagger = ms from contact the victim can't act, counting the hit's freeze (hitFeel.js): every hit
// interrupts, so a clean hit wins the exchange instead of both fighters trading.
// knockback = px the victim slides away, over `slide` ms, fast at first and easing out.
export const ATTACKS = Object.freeze({
  punch: { key: 'C', damage: 4, cooldown: 300, frames: [70, 90, 60, 100], reach: 34, width: 20, lunge: 60, knockback: 7, slide: 120, stagger: 210 },
  kick: { key: 'X', damage: 9, cooldown: 5000, frames: [110, 120, 80, 150], reach: 50, width: 22, lunge: 80, knockback: 15, slide: 160, stagger: 340 },
  headbutt: { key: 'Z', damage: 10, cooldown: 10000, frames: [150, 110, 90, 200], reach: 30, width: 20, lunge: 110, knockback: 49, slide: 300, stagger: 350 },
  bellow: { key: 'S', character: 'james', damage: 10, cooldown: 25000, frames: [350, 120, 180, 250], radial: true, reach: 10 * 16, speed: 0, knockback: 0, stagger: 5000, stun: 5000, unblockable: true },
  grapple: { key: 'S', character: 'mason', damage: 25, cooldown: 20000, frames: [450, 120, 2000, 300], reach: 22, width: 10, maxTargets: 1, speed: 0, knockback: 11, slide: 200, stagger: 250, hold: true },
  takedown: { key: 'S', character: 'titus', damage: 30, cooldown: 20000, frames: [500, 100, 180, 320], reach: 24, width: 10, maxTargets: 1, speed: 0, knockback: 4, slide: 80, stagger: 1500, knockdown: 1500 },
});
// A knockback's starting speed (px/s): sliding `knockback` px over `slide` ms, slowing evenly to a stop.
export const pushSpeed = (knockback, slide) => slide > 0 ? 2 * knockback * 1000 / slide : 0;
// Positions are body centres, but people are hit on their body, not at their centre: every
// attack zone is credited the defender's half-width on all sides.
export const BODY = 9;
// Preserve attack geometry, animation timing and special moves; only basic balance varies.
export function characterAttack(character, name) {
  const base = ATTACKS[name], stats = characterStats(character);
  if (!['punch', 'kick', 'headbutt'].includes(name)) return base;
  return { ...base, damage: stats[name], cooldown: stats[name + 'Cooldown'] ?? base.cooldown };
}
// A block covers every side but the one behind you (`facing` is its middle). A hit in its first `perfect` ms
// does no damage and staggers the attacker for PARRY.stagger: a reward for reading the swing.
export const BLOCK = Object.freeze({ duration: 3000, cooldown: 1000, reduction: 0.75, speed: 0.5, perfect: 120 });
export const PARRY = Object.freeze({ stagger: 450, knockback: 10, slide: 140 });
// A press made while the fighter can't act (mid-swing, mid-stagger) is remembered this long and fires on the
// first frame it's free. Only the latest press is kept, so a held key still never repeats.
export const BUFFER_MS = 150;
// Shift (or Space): a quick hop of `distance` px over `duration` ms, untouchable for the first `invulnerable`.
export const DODGE = Object.freeze({ distance: 40, duration: 160, invulnerable: 150, cooldown: 900 });
// Held in a Grapple or stunned by a Bellow, every press (an arrow or a button) takes time off: down to a hold of
// `grappleFloor` ms, or a stun of `stunFloor`. Presses closer than `gap` count once. Let go, a fighter can't be
// grabbed again for `regrab` ms.
export const MASH = Object.freeze({ grapple: 120, grappleFloor: 600, stun: 150, stunFloor: 1000, gap: 50, regrab: 1000 });
export const OPPOSITE = Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' });
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
  if (spec.radial) return targets.filter(t => Math.hypot(t.x-source.x, t.y-source.y) <= spec.reach && !wallBetween(walls, source, t))
    .sort((a,b) => Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y));
  const [fx, fy] = DIRECTIONS[facing], points = [...path, source];
  return targets.filter(target => points.some((point, i) => zoneAlong(points[i - 1] ?? point, point, target, fx, fy, spec)
      && !wallBetween(walls, point, target)))
    .sort((a, b) => Math.hypot(a.x-source.x, a.y-source.y) - Math.hypot(b.x-source.x, b.y-source.y));
}

// A tap aims itself, as Brawl Stars' quick-fire does: the facing toward the nearest opponent within AIM_REACH of
// the move's reach (by the stronger axis, for the four directions), or null when nobody's that close.
// `held` (the directions the arrows hold) overrides it: one held direction is kept as it is, and a diagonal
// keeps whichever of its two directions has someone in range, so aiming stays in the player's hands.
export const AIM_REACH = 1.5;
export function aimFacing(source, opponents, spec, held = [], walls = null) {
  if (spec.radial) return null;
  if (held.length === 1) return held[0];
  if (held.length) {
    // The nearest opponent either held direction reaches; the direction that points at them if both do.
    const hit = held.map(dir => ({ dir, t: attackTargets(source, opponents, dir, spec, [], walls)[0] })).filter(o => o.t)
      .sort((a, b) => Math.hypot(a.t.x - source.x, a.t.y - source.y) - Math.hypot(b.t.x - source.x, b.t.y - source.y));
    if (!hit.length) return held[0];
    const toward = directionTo(hit[0].t.x - source.x, hit[0].t.y - source.y);
    return hit.some(o => o.dir === toward && o.t === hit[0].t) ? toward : hit[0].dir;
  }
  let best = null;
  for (const o of opponents) {
    const d = Math.hypot(o.x - source.x, o.y - source.y);
    if (d > AIM_REACH * (spec.reach + BODY) || wallBetween(walls, source, o) || (best && d >= best.d)) continue;
    best = { d, o };
  }
  return best ? directionTo(best.o.x - source.x, best.o.y - source.y) : null;
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
  reset() { this.value = this.max; this.quiet = 0; this.stunUntil = 0; this.healingBlockedFor = 0; for (const name of Object.keys(this.readyAt ?? {})) delete this.readyAt[name]; this.onChange(this.value); }
  take(amount) {
    if (amount <= 0 || this.value <= 0) return 0;
    const before = this.value;
    this.value = Math.max(0, this.value - amount);
    this.quiet = 0;
    this.onChange(this.value);
    return before - this.value;
  }
  heal(amount) {
    if (amount <= 0 || this.healingBlockedFor > 0 || this.value <= 0) return 0;
    const before = this.value;
    this.value = Math.min(this.max, this.value + amount);
    if (this.value !== before) this.onChange(this.value);
    return this.value - before;
  }
  update(delta) {
    const before = this.quiet, blocked = Math.min(delta, this.healingBlockedFor ?? 0);
    this.healingBlockedFor = Math.max(0, (this.healingBlockedFor ?? 0) - delta);
    this.quiet += delta;
    const healingTime = Math.max(0, this.quiet - Math.max(REGEN.delay, before + blocked));
    if (healingTime) this.heal(healingTime * REGEN.perSecond / 1000);
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
    this.buffered = null;   // { name, at }: the latest press, waiting for the fighter to be free (BUFFER_MS)
    this.dodge = null;
  }
  setCharacter(character) {
    this.character = character;
    this.health.setMax(characterStats(character).health);
  }
  get stunUntil() { return this.health.stunUntil ?? 0; }
  attackSpec(name) { return characterAttack(this.character, name); }
  // The attacks this fighter has: the three basics and its own Super.
  moves() { return Object.keys(ATTACKS).filter(name => !ATTACKS[name].character || ATTACKS[name].character === this.character); }
  // Remember a fresh press for BUFFER_MS (block first, then the attacks in order, then the dodge). Run every
  // frame, also while the fighter can't act (frozen, staggered, held), so a press made a moment early still
  // counts. Returns what was freshly pressed this frame.
  watch(now, input) {
    const fresh = ['block', ...this.moves(), 'dodge'].filter(name => input[name] && !this.previous[name]);
    if (fresh.length) this.buffered = { name: fresh[0], at: now };
    else if (this.buffered && now - this.buffered.at > BUFFER_MS) this.buffered = null;
    this.previous = { ...input };
    return fresh;
  }
  // `dud` is set to the move whose key was just pressed while it was still cooling down (null otherwise), so
  // the HUD can say no out loud instead of the press silently doing nothing. Only cooldowns of a second or
  // more count: a mashed punch isn't a dud.
  update(now, input, facing) {
    this.dud = null;
    if (this.block && (!input.block || now >= this.block.until)) this.endBlock(now);
    if (this.dodge && now >= this.dodge.until) this.dodge = null;
    const fresh = this.watch(now, input);
    if (this.health.value > 0 && !this.heldBy && now >= this.stunUntil) {
      if (fresh.includes('block') && !this.block && now < this.blockReadyAt) this.dud = 'block';
      for (const name of this.moves()) if (fresh.includes(name) && now < (this.readyAt[name] ?? 0) && this.attackSpec(name).cooldown >= 1000) this.dud = name;
    }
    // A dodge gets you out of a block.
    if (this.block && this.buffered?.name === 'dodge' && now >= (this.readyAt.dodge ?? 0)) this.endBlock(now);
    const available = !this.heldBy && !this.attack && !this.block && !this.dodge && now >= this.staggerUntil && now >= this.stunUntil && this.health.value > 0;
    if (available && this.buffered && this.start(this.buffered.name, now, input, facing)) this.buffered = null;
  }
  // Start a move if it's ready; false if it isn't (it stays buffered). A block only goes up while its key is held.
  start(name, now, input, facing) {
    if (name === 'block') {
      if (!input.block || now < this.blockReadyAt) return false;
      this.block = { facing, start: now, until: now + characterStats(this.character).blockDuration };
    } else if (name === 'dodge') {
      if (now < (this.readyAt.dodge ?? 0)) return false;
      // Where the arrows point (eight ways), or straight ahead.
      const dx = Number(!!input.right) - Number(!!input.left), dy = Number(!!input.down) - Number(!!input.up);
      const [fx, fy] = dx || dy ? [dx, dy] : DIRECTIONS[facing], length = Math.hypot(fx, fy);
      this.dodge = { dx: fx / length, dy: fy / length, facing: directionTo(fx, fy) ?? facing, start: now, until: now + DODGE.duration };
      this.invulnerableUntil = now + DODGE.invulnerable;
      this.readyAt.dodge = now + DODGE.cooldown;
    } else {
      if (now < (this.readyAt[name] ?? 0)) return false;
      this.attack = { name, facing, start: now };
      this.readyAt[name] = now + this.attackSpec(name).cooldown;
    }
    return true;
  }
  finishAttack() { this.attack = null; }
  endBlock(now) { this.block = null; this.blockReadyAt = now + BLOCK.cooldown; }
  // Every side but the one behind the block. A hit from no side (a hazard) isn't blocked.
  blocks(incomingSide, now) { return !!this.block && now < this.block.until && !!incomingSide && incomingSide !== OPPOSITE[this.block.facing]; }
  // A perfect block stopped this fighter's swing: it's interrupted and staggered, pushed back a little.
  parried(now) {
    this.attack = null;
    this.staggerUntil = Math.max(this.staggerUntil, now + PARRY.stagger);
    return { damage: 0, parried: true, blocked: false, stagger: PARRY.stagger, stun: 0, knockdown: 0, knockback: PARRY.knockback, slide: PARRY.slide };
  }
  // A press while stunned: the stun, and the stagger that holds it, end MASH.stun ms sooner, down to MASH.stunFloor.
  shakeOff(now) {
    if (now >= this.stunUntil) return false;
    const until = Math.max(now, (this.health.stunSince ?? now) + MASH.stunFloor, this.stunUntil - MASH.stun);
    this.health.stunUntil = until;
    this.staggerUntil = Math.min(this.staggerUntil, until);
    return true;
  }
  // `contact`: when the swing actually reached them, if earlier than now (the host only judges hits on its tick).
  receive(spec, incomingSide, now, contact = now) {
    // Mid-dodge: untouched.
    if (Math.min(now, contact) < (this.invulnerableUntil ?? 0) && spec.damage) return { damage: 0, dodged: true, blocked: false, stagger: 0, stun: 0, knockdown: 0, knockback: 0, slide: 0 };
    const blocked = !spec.unblockable && this.blocks(incomingSide, now);
    if (blocked && contact - this.block.start < BLOCK.perfect) {
      return { damage: 0, blocked: true, perfect: true, stagger: 0, stun: 0, knockdown: 0, knockdownFacing: null, knockback: 0, slide: 0 };
    }
    const damage = this.health.take(spec.damage * (blocked ? 1 - BLOCK.reduction : 1));
    const stun = blocked ? 0 : (spec.stun ?? 0);
    if (damage && stun) {
      if (now >= this.stunUntil) this.health.stunSince = now;
      this.health.stunUntil = Math.max(this.stunUntil, now + stun);
      this.health.stunFacing = incomingSide ?? 'down';
      this.health.healingBlockedFor = Math.max(this.health.healingBlockedFor ?? 0, stun);
    }
    const stagger = blocked ? 0 : Math.max(spec.stagger ?? 0, stun);
    const knockdown = blocked ? 0 : (spec.knockdown ?? 0);
    if (damage && stagger) {
      this.attack = null;
      this.dodge = null;
      if (this.block) this.endBlock(now);
      this.staggerUntil = Math.max(this.staggerUntil, now + stagger);
      this.knockedDownUntil = Math.max(this.knockedDownUntil, now + knockdown);
      if (knockdown) this.knockdownFacing = incomingSide;
      else this.hurtFacing = incomingSide;
    }
    return { damage, blocked, stagger, stun, knockdown, knockdownFacing: knockdown ? incomingSide : null,
      knockback: (spec.knockback ?? 0) * (blocked ? 0.25 : 1), slide: spec.slide ?? 0 };
  }
}
