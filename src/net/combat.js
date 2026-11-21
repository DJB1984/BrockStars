import { ShowerWorld, SHOWER } from '../showers.js';
import { ATTACKS, CombatRules, DIRECTIONS, directionTo, attackTargets, extendPath } from '../combat/rules.js';
import { levelWalls } from '../combat/walls.js';

import { GrappleHold, grapplePosition } from '../combat/grapple.js';

// Lag compensation. Everyone draws the other players a little in the past (remotes.js), so the host keeps
// HISTORY_MS of each fighter's positions and judges an attack against where its victims stood at the moment
// the attacker was looking at: the host time the attacker's screen showed (`seen`, sent with the command).
// A claim older than MAX_REWIND isn't believed past that, and TOLERANCE either side of the moment absorbs the
// smoothing between snapshots. A victim can now and then be hit just after stepping out of range on their own
// screen: fairer than a swing that clearly connected and missed.
export const HISTORY_MS = 1000, MAX_REWIND = 300, TOLERANCE = 40;

// Where a fighter stood at host time t, between the two history samples around it.
export function positionAt(history, t, current) {
  if (!history?.length || t >= history.at(-1).t) return current;
  if (t <= history[0].t) return history[0];
  let i = history.length - 1;
  while (history[i - 1].t > t) i--;
  const a = history[i - 1], b = history[i], u = (t - a.t) / Math.max(1, b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

// Only the host runs this clock. Clients send actions (with when they saw the world), never damage.
// walls(level) gives a level's wall grid (walls.js), so nobody is hit through a wall.
export class RoomCombat {
  constructor({ walls = levelWalls } = {}) { this.fighters = new Map(); this.last = null; this.events = []; this.walls = walls; this.showers = new ShowerWorld(); }

  sync(players, now, connected = Object.keys(players)) {
    const members = new Set(connected);
    for (const [id, fighter] of this.fighters) {
      if (!members.has(id)) this.fighters.delete(id);
      else fighter.present = false;
    }
    for (const [id, position] of Object.entries(players)) {
      let f = this.fighters.get(id);
      if (!f) {
        f = { rules: new CombatRules(undefined, position.char ?? 'titus'), life: 0, respawnAt: null, action: null, lastCommand: 0 };
        this.fighters.set(id, f);
      }
      f.position = { ...position };
      if (f.rules.stunUntil > now) {
        if (f.stunAnchor?.level !== position.level) f.stunAnchor = { x:position.x, y:position.y, level:position.level };
        Object.assign(f.position, { x:f.stunAnchor.x, y:f.stunAnchor.y });
      }
      if (f.rules.character !== (position.char ?? 'titus')) { f.rules.attack = null; f.action = null; }
      f.rules.setCharacter(position.char ?? 'titus');
      f.present = true;
      if (f.level !== position.level) {
        f.rules.attack = null; f.action = null; f.rules.block = null;
        f.level = position.level;
      }
    }
  }

  command(id, command, now) {
    const f = this.fighters.get(id);
    if (!f?.present || !command || !Number.isSafeInteger(command.n) || command.n <= f.lastCommand) return;
    f.lastCommand = command.n;
    const r = f.rules;
    if (command.action === 'release') { if (r.block) r.endBlock(now); return; }
    if (command.action === 'interact') {
      if (r.health.value > 0 && !r.heldBy && now >= r.stunUntil && now >= (f.interactReady ?? 0)) {
        if (this.showers.toggle(f.level, f.position)) f.interactReady = now + 250;
      }
      return;
    }
    if (command.action === 'hazard') {
      if (now >= (f.hazardReady ?? 0)) {
        f.hazardReady = now + 1000;
        this.damage(id, null, ATTACKS.punch, null, now);
      }
      return;
    }
    if (!DIRECTIONS[command.facing] || ![...Object.keys(ATTACKS), 'block'].includes(command.action)) return;
    this.expire(f, now);
    r.previous = {}; // these are distinct key presses, not a held input stream
    r.update(now, { [command.action]: true }, command.facing);
    // How far back the attacker saw everyone else: judged against that moment, within MAX_REWIND.
    const rewind = Number.isFinite(command.seen) ? Math.min(MAX_REWIND, Math.max(0, now - command.seen)) : 0;
    if (r.attack && !f.action) f.action = { ...r.attack, start: now, checked: now, struck: new Set(), path: [{ x: f.position.x, y: f.position.y }], rewind };
  }

  expire(f, now) {
    if (f.action && now >= f.action.start + ATTACKS[f.action.name].frames.reduce((a,b) => a+b, 0)) {
      f.rules.finishAttack(); f.action = null;
    }
    if (f.rules.block && now >= f.rules.block.until) f.rules.endBlock(now);
  }

  // `move` names the attack (punch, grapple...) so clients can make the hit feel right; null for hazards.
  damage(targetId, sourceId, spec, from, now, move = null) {
    const f = this.fighters.get(targetId);
    const p = f.position;
    const result = f.rules.receive(spec, from ? directionTo(from.x-p.x, from.y-p.y) : null, now);
    if (!result.damage) return;
    if (result.stun) f.stunAnchor = { x:p.x, y:p.y, level:f.level };
    if (result.stagger) { f.action = null; f.rules.heldBy?.cancel(); }
    this.events.push({ target: targetId, source: sourceId, from, move, ...result });
    if (!f.rules.health.value) f.respawnAt = now + 400;
  }

  updateGrapples(now) {
    // Captives and holders use host positions, regardless of incoming movement snapshots.
    for (const [id, f] of this.fighters) {
      if (!f.hold) continue;
      const { hold, targetId, anchor, level, character } = f.hold;
      const victim = this.fighters.get(targetId);
      if (!f.present || !victim?.present || f.level !== level || victim.level !== level || victim.rules !== hold.target || victim.rules.character !== character) hold.cancel();
      const state = hold.update(now);
      if (state === 'holding') {
        Object.assign(f.position, anchor);
        Object.assign(victim.position, grapplePosition(anchor, hold.attack.facing));
      } else {
        f.hold = null;
        if (state === 'damage') this.damage(targetId, id, f.rules.attackSpec('grapple'), anchor, now, 'grapple');
      }
    }
    // A disconnected holder must not leave a surviving player permanently captured.
    for (const f of this.fighters.values()) {
      if (f.rules.heldBy && !this.fighters.get(f.heldSource)?.hold) f.rules.heldBy.cancel();
    }
  }

  tick(players, now, connected) {
    this.sync(players, now, connected);
    for (const f of this.fighters.values()) {
      const h = (f.history ??= []);
      if (h.length && f.level !== h.at(-1).level) h.length = 0;   // a door: the old level's positions are gone
      h.push({ t: now, x: f.position.x, y: f.position.y, level: f.level });
      while (h.length > 2 && h[1].t < now - HISTORY_MS) h.shift();
    }
    const delta = this.last === null ? 0 : Math.max(0, now-this.last);
    this.last = now;
    for (const f of this.fighters.values()) {
      f.rules.health.update(delta);
      if (f.respawnAt !== null && now >= f.respawnAt) {
        f.rules = new CombatRules(undefined, f.position.char ?? 'titus'); f.action = null; f.respawnAt = null; f.life++;
      }
    }
    this.showers.update(delta);
    this.updateGrapples(now);
    for (const [id, f] of this.fighters) {
      if (f.present && f.rules.health.value > 0 && this.showers.burning(f.level, f.position)) {
        f.burn = (f.burn ?? 0) + delta;
        while (f.burn >= SHOWER.interval && f.rules.health.value > 0) {
          this.damage(id, null, { damage: SHOWER.damage, unblockable: true, knockback: 0 }, null, now);
          f.burn -= SHOWER.interval;
        }
      } else f.burn = 0;
    }
    for (const [id, f] of this.fighters) {
      const a = f.action;
      if (a && f.present && f.rules.health.value > 0) {
        const spec = f.rules.attackSpec(a.name), begin = a.start+spec.frames[0], end = begin+spec.frames[1];
        // Every snapshot from the wind-up on, so a lunge through someone between checks still lands.
        if (a.checked <= end) extendPath(a.path, f.position);
        // Intersect the whole tick interval so a 60ms punch cannot fall between 66ms snapshots.
        if (now >= begin && a.checked <= end) {
          const p = f.position;
          const others = [...this.fighters].filter(([target, other]) => target!==id && other.present && !a.struck.has(target) && other.level===f.level && other.rules.health.value > 0 && (!spec.hold || !other.rules.heldBy));
          // Everyone where the attacker saw them (and a moment either side), or where they are now with no rewind.
          const found = new Map();
          for (const t of a.rewind ? [now - a.rewind, now - a.rewind - TOLERANCE, now - a.rewind + TOLERANCE] : [now]) {
            const candidates = others.map(([id, other]) => ({ id, ...positionAt(other.history, t, other.position) }));
            for (const o of attackTargets(p, candidates, a.facing, spec, a.path, this.walls(f.level))) if (!found.has(o.id)) found.set(o.id, o);
          }
          const hit = [...found.values()].sort((u, v) => Math.hypot(u.x-p.x, u.y-p.y) - Math.hypot(v.x-p.x, v.y-p.y));
          for (const other of hit) {
            if (a.struck.size >= (spec.maxTargets ?? Infinity)) break;
            const target = other.id;
            a.struck.add(target);
            const victim = this.fighters.get(target);
            if (spec.hold && !victim.rules.blocks(directionTo(p.x-other.x, p.y-other.y), now)) {
              const hold = new GrappleHold(f.rules, victim.rules, f.rules.attack, now);
              victim.action = null;
              victim.heldSource = id;
              f.hold = { hold, targetId: target, anchor: { x:p.x, y:p.y }, level: f.level, character: victim.rules.character };
            } else this.damage(target, id, spec, {x:p.x,y:p.y}, now, a.name);
          }
        }
        a.checked = now;
      }
    }
    this.updateGrapples(now);
    for (const f of this.fighters.values()) this.expire(f, now);
    const fighters = Object.fromEntries([...this.fighters].map(([id,f]) => [id, {
      health: f.rules.health.value, maxHealth: f.rules.health.max, life: f.life,
      attack: f.action ? {name:f.action.name, facing:f.action.facing, elapsed:now-f.action.start} : null,
      block: f.rules.block?.facing ?? null,
      stun: Math.max(0, f.rules.stunUntil-now),
      stunPosition: now < f.rules.stunUntil ? { x:f.position.x, y:f.position.y } : null,
      stunFacing: f.rules.health.stunFacing ?? null,
      healingBlockedFor: f.rules.health.healingBlockedFor ?? 0,
      bellowCooldown: Math.max(0, (f.rules.readyAt.bellow ?? 0)-now),
      stagger: Math.max(0, f.rules.staggerUntil-now),
      knockdown: Math.max(0, f.rules.knockedDownUntil-now),
      knockdownFacing: f.rules.knockdownFacing ?? null,
      hurtFacing: f.rules.hurtFacing ?? null,
      grappleCooldown: Math.max(0, (f.rules.readyAt.grapple ?? 0)-now),
      grapple: f.hold ? { target: f.hold.targetId, ...f.hold.anchor, facing: f.hold.hold.attack.facing } : null,
      held: f.rules.heldBy ? { source: f.heldSource, ...f.position, facing: f.rules.heldBy.attack.facing } : null,
      takedownCooldown: Math.max(0, (f.rules.readyAt.takedown ?? 0)-now),
    }]));
    return { fighters, hits: this.events.splice(0), showers: this.showers.levels };
  }
}
