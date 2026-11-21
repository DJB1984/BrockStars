import { ATTACKS, DIRECTIONS, MASH } from './rules.js';

// Shared local/host lifecycle: one captive, damage only after the choke finishes. The captive can mash: every
// press brings the end MASH.grapple ms closer, but the hold lasts at least MASH.grappleFloor from when it took,
// and the choke still lands when it ends. However it ends, the captive can't be grabbed again for MASH.regrab.
export class GrappleHold {
  constructor(source, target, attack, now) {
    this.source = source;
    this.target = target;
    this.attack = attack;
    this.since = now;
    this.until = attack.start + ATTACKS.grapple.frames.slice(0, 3).reduce((a, b) => a + b, 0);
    this.mashed = 0;
    this.active = true;
    target.heldBy = this;
    target.attack = null;
    if (target.block) target.endBlock(now);
  }
  cancel(now) {
    this.active = false;
    if (this.target.heldBy === this) this.target.heldBy = null;
    if (Number.isFinite(now)) this.target.grabImmuneUntil = now + MASH.regrab;
  }
  // A press from the captive.
  mash(now) {
    if (!this.active) return false;
    this.until = Math.max(this.since + MASH.grappleFloor, now, this.until - MASH.grapple);
    this.mashed++;
    return true;
  }
  update(now) {
    if (!this.active) return 'released';
    if (this.source.attack !== this.attack || this.source.health.value <= 0 || this.target.health.value <= 0) {
      this.cancel(now); return 'released';
    }
    if (now >= this.until) { this.cancel(now); return 'damage'; }
    return 'holding';
  }
}

// Can this fighter's rules be grabbed right now? Not while held, nor just after being let go.
export const grabbable = (rules, now) => !!rules && !rules.heldBy && now >= (rules.grabImmuneUntil ?? 0);

export function grapplePosition(anchor, facing) {
  const [fx, fy] = DIRECTIONS[facing];
  return { x: anchor.x + fx * 14 + (fy ? 12 : 0), y: anchor.y + fy * 9 };
}
