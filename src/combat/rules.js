import { characterStats } from '../characters.js';

export const ATTACKS = Object.freeze({
  punch: { key: 'C', damage: 4, cooldown: 400, frames: [100, 60, 90, 150], reach: 28, knockback: 25, stagger: 0 },
  kick: { key: 'X', damage: 9, cooldown: 5000, frames: [160, 100, 120, 220], reach: 44, knockback: 45, stagger: 0 },
  headbutt: { key: 'Z', damage: 10, cooldown: 10000, frames: [220, 80, 120, 280], reach: 24, knockback: 140, stagger: 350 },
  takedown: { key: 'S', character: 'titus', damage: 25, cooldown: 20000, frames: [500, 100, 180, 320], reach: 24, width: 10, maxTargets: 1, speed: 0, knockback: 45, stagger: 1500, knockdown: 1500 },
});
// Preserve attack geometry, animation timing and special moves; only basic balance varies.
export function characterAttack(character, name) {
  const base = ATTACKS[name], stats = characterStats(character);
  if (!['punch', 'kick', 'headbutt'].includes(name)) return base;
  return { ...base, damage: stats[name], cooldown: stats[name + 'Cooldown'] ?? base.cooldown };
}
export const BLOCK = Object.freeze({ duration: 3000, cooldown: 1000, reduction: 0.75, speed: 0.5 });
export const REGEN = Object.freeze({ delay: 45000, perSecond: 2 });
export const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });

export function directionTo(dx, dy) {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// Share target geometry and nearest-first selection between local play and the host.
export function attackTargets(source, targets, facing, spec) {
  const [fx, fy] = DIRECTIONS[facing];
  return targets.filter(target => {
    const dx = target.x - source.x, dy = target.y - source.y;
    const forward = dx * fx + dy * fy, across = Math.abs(dx * fy - dy * fx);
    return forward >= 0 && forward <= spec.reach && across <= (spec.width ?? 18);
  }).sort((a, b) => Math.hypot(a.x-source.x, a.y-source.y) - Math.hypot(b.x-source.x, b.y-source.y));
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
          this.attack = { name, facing };
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
