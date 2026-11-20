import { ATTACKS, CombatRules, DIRECTIONS, directionTo, attackTargets, extendPath } from '../combat/rules.js';
import { levelWalls } from '../combat/walls.js';

import { GrappleHold, grapplePosition } from '../combat/grapple.js';

// Only the host runs this clock. Clients send actions, never damage or hit claims.
// walls(level) gives a level's wall grid (walls.js), so nobody is hit through a wall.
export class RoomCombat {
  constructor({ walls = levelWalls } = {}) { this.fighters = new Map(); this.last = null; this.events = []; this.walls = walls; }

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
    if (r.attack && !f.action) f.action = { ...r.attack, start: now, checked: now, struck: new Set(), path: [{ x: f.position.x, y: f.position.y }] };
  }

  expire(f, now) {
    if (f.action && now >= f.action.start + ATTACKS[f.action.name].frames.reduce((a,b) => a+b, 0)) {
      f.rules.finishAttack(); f.action = null;
    }
    if (f.rules.block && now >= f.rules.block.until) f.rules.endBlock(now);
  }

  damage(targetId, sourceId, spec, from, now) {
    const f = this.fighters.get(targetId);
    const p = f.position;
    const result = f.rules.receive(spec, from ? directionTo(from.x-p.x, from.y-p.y) : null, now);
    if (!result.damage) return;
    if (result.stun) f.stunAnchor = { x:p.x, y:p.y, level:f.level };
    if (result.stagger) { f.action = null; f.rules.heldBy?.cancel(); }
    this.events.push({ target: targetId, source: sourceId, from, ...result });
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
        if (state === 'damage') this.damage(targetId, id, f.rules.attackSpec('grapple'), anchor, now);
      }
    }
    // A disconnected holder must not leave a surviving player permanently captured.
    for (const f of this.fighters.values()) {
      if (f.rules.heldBy && !this.fighters.get(f.heldSource)?.hold) f.rules.heldBy.cancel();
    }
  }

  tick(players, now, connected) {
    this.sync(players, now, connected);
    const delta = this.last === null ? 0 : Math.max(0, now-this.last);
    this.last = now;
    for (const f of this.fighters.values()) {
      f.rules.health.update(delta);
      if (f.respawnAt !== null && now >= f.respawnAt) {
        f.rules = new CombatRules(undefined, f.position.char ?? 'titus'); f.action = null; f.respawnAt = null; f.life++;
      }
    }
    this.updateGrapples(now);
    for (const [id, f] of this.fighters) {
      const a = f.action;
      if (a && f.present && f.rules.health.value > 0) {
        const spec = f.rules.attackSpec(a.name), begin = a.start+spec.frames[0], end = begin+spec.frames[1];
        // Every snapshot from the wind-up on, so a lunge through someone between checks still lands.
        if (a.checked <= end) extendPath(a.path, f.position);
        // Intersect the whole tick interval so a 60ms punch cannot fall between 66ms snapshots.
        if (now >= begin && a.checked <= end) {
          const p = f.position;
          const candidates = [...this.fighters].filter(([target, other]) => target!==id && other.present && !a.struck.has(target) && other.level===f.level && other.rules.health.value > 0 && (!spec.hold || !other.rules.heldBy))
            .map(([id, other]) => ({id, ...other.position}));
          for (const other of attackTargets(p, candidates, a.facing, spec, a.path, this.walls(f.level))) {
            if (a.struck.size >= (spec.maxTargets ?? Infinity)) break;
            const target = other.id;
            a.struck.add(target);
            const victim = this.fighters.get(target);
            if (spec.hold && !victim.rules.blocks(directionTo(p.x-other.x, p.y-other.y), now)) {
              const hold = new GrappleHold(f.rules, victim.rules, f.rules.attack, now);
              victim.action = null;
              victim.heldSource = id;
              f.hold = { hold, targetId: target, anchor: { x:p.x, y:p.y }, level: f.level, character: victim.rules.character };
            } else this.damage(target, id, spec, {x:p.x,y:p.y}, now);
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
      grappleCooldown: Math.max(0, (f.rules.readyAt.grapple ?? 0)-now),
      grapple: f.hold ? { target: f.hold.targetId, ...f.hold.anchor, facing: f.hold.hold.attack.facing } : null,
      held: f.rules.heldBy ? { source: f.heldSource, ...f.position, facing: f.rules.heldBy.attack.facing } : null,
      takedownCooldown: Math.max(0, (f.rules.readyAt.takedown ?? 0)-now),
    }]));
    return { fighters, hits: this.events.splice(0) };
  }
}
