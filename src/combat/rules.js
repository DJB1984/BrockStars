export const ATTACKS = Object.freeze({
  punch: { key: 'C', damage: 4, cooldown: 400, frames: [100, 60, 90, 150], reach: 28, knockback: 25, stagger: 0 },
  kick: { key: 'X', damage: 6, cooldown: 800, frames: [160, 100, 120, 220], reach: 44, knockback: 45, stagger: 0 },
  headbutt: { key: 'Z', damage: 10, cooldown: 1500, frames: [220, 80, 120, 280], reach: 24, knockback: 140, stagger: 350 },
});
export const BLOCK = Object.freeze({ duration: 3000, cooldown: 1000, reduction: 0.75, speed: 0.5 });
export const REGEN = Object.freeze({ delay: 45000, perSecond: 2 });
export const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });

export function directionTo(dx, dy) {
  if (!dx && !dy) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// Continuous game time, including time spent moving between levels. A blocked hit still resets regen.
export class HealthPool {
  constructor(onChange = () => {}) { this.max = 100; this.value = 100; this.quiet = 0; this.onChange = onChange; }
  reset() { this.value = this.max; this.quiet = 0; this.onChange(this.value); }
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
  constructor(health = new HealthPool()) {
    this.health = health;
    this.attack = null;
    this.block = null;
    this.readyAt = {};
    this.blockReadyAt = 0;
    this.staggerUntil = 0;
    this.previous = {};
  }
  update(now, input, facing) {
    if (this.block && (!input.block || now >= this.block.until)) this.endBlock(now);
    const available = !this.attack && !this.block && now >= this.staggerUntil && this.health.value > 0;
    if (available && input.block && !this.previous.block && now >= this.blockReadyAt) {
      this.block = { facing, until: now + BLOCK.duration };
    } else if (available) {
      for (const [name, spec] of Object.entries(ATTACKS)) {
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
    if (damage && stagger) {
      this.attack = null;
      if (this.block) this.endBlock(now);
      this.staggerUntil = now + stagger;
    }
    return { damage, blocked, stagger, knockback: spec.knockback * (blocked ? 0.25 : 1) };
  }
}
