import { ATTACKS, DIRECTIONS } from './rules.js';

// Shared local/host lifecycle: one captive, damage only after the choke finishes.
export class GrappleHold {
  constructor(source, target, attack, now) {
    this.source = source;
    this.target = target;
    this.attack = attack;
    this.until = attack.start + ATTACKS.grapple.frames.slice(0, 3).reduce((a, b) => a + b, 0);
    this.active = true;
    target.heldBy = this;
    target.attack = null;
    if (target.block) target.endBlock(now);
  }
  cancel() {
    this.active = false;
    if (this.target.heldBy === this) this.target.heldBy = null;
  }
  update(now) {
    if (!this.active) return 'released';
    if (this.source.attack !== this.attack || this.source.health.value <= 0 || this.target.health.value <= 0) {
      this.cancel(); return 'released';
    }
    if (now >= this.until) { this.cancel(); return 'damage'; }
    return 'holding';
  }
}

export function grapplePosition(anchor, facing) {
  const [fx, fy] = DIRECTIONS[facing];
  return { x: anchor.x + fx * 14 + (fy ? 12 : 0), y: anchor.y + fy * 9 };
}
