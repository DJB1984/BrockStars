import { ATTACKS, CombatRules, DIRECTIONS, directionTo } from '../combat/rules.js';

// Only the host runs this clock. Clients send actions, never damage or hit claims.
export class RoomCombat {
  constructor() { this.fighters = new Map(); this.last = null; this.events = []; }

  sync(players, now, connected = Object.keys(players)) {
    const members = new Set(connected);
    for (const [id, fighter] of this.fighters) {
      if (!members.has(id)) this.fighters.delete(id);
      else fighter.present = false;
    }
    for (const [id, position] of Object.entries(players)) {
      let f = this.fighters.get(id);
      if (!f) {
        f = { rules: new CombatRules(), life: 0, respawnAt: null, action: null, lastCommand: 0 };
        this.fighters.set(id, f);
      }
      f.position = position;
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
    if (!DIRECTIONS[command.facing] || !['punch', 'kick', 'headbutt', 'block'].includes(command.action)) return;
    this.expire(f, now);
    r.previous = {}; // these are distinct key presses, not a held input stream
    r.update(now, { [command.action]: true }, command.facing);
    if (r.attack && !f.action) f.action = { ...r.attack, start: now, checked: now, struck: new Set() };
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
    if (result.stagger) f.action = null;
    this.events.push({ target: targetId, source: sourceId, from, ...result });
    if (!f.rules.health.value) f.respawnAt = now + 400;
  }

  tick(players, now, connected) {
    this.sync(players, now, connected);
    const delta = this.last === null ? 0 : Math.max(0, now-this.last);
    this.last = now;
    for (const f of this.fighters.values()) {
      f.rules.health.update(delta);
      if (f.respawnAt !== null && now >= f.respawnAt) {
        f.rules = new CombatRules(); f.action = null; f.respawnAt = null; f.life++;
      }
    }
    for (const [id, f] of this.fighters) {
      const a = f.action;
      if (a && f.present && f.rules.health.value > 0) {
        const spec = ATTACKS[a.name], begin = a.start+spec.frames[0], end = begin+spec.frames[1];
        // Intersect the whole tick interval so a 60ms punch cannot fall between 66ms snapshots.
        if (now >= begin && a.checked <= end) {
          const [fx, fy] = DIRECTIONS[a.facing], p = f.position;
          for (const [target, other] of this.fighters) {
            if (target===id || !other.present || a.struck.has(target) || other.level!==f.level || !other.rules.health.value) continue;
            const dx = other.position.x-p.x, dy = other.position.y-p.y;
            const forward = dx*fx+dy*fy, across = Math.abs(dx*fy-dy*fx);
            if (forward < 0 || forward > spec.reach || across > 18) continue;
            a.struck.add(target);
            this.damage(target, id, spec, {x:p.x,y:p.y}, now);
          }
        }
        a.checked = now;
      }
      this.expire(f, now);
    }
    const fighters = Object.fromEntries([...this.fighters].map(([id,f]) => [id, {
      health: f.rules.health.value, life: f.life,
      attack: f.action ? {name:f.action.name, facing:f.action.facing, elapsed:now-f.action.start} : null,
      block: f.rules.block?.facing ?? null,
      stagger: Math.max(0, f.rules.staggerUntil-now),
    }]));
    return { fighters, hits: this.events.splice(0) };
  }
}
