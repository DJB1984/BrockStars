import test from 'node:test';
import assert from 'node:assert/strict';
import { characterAttack, ATTACKS, BODY, DIRECTIONS, attackAnim, attackTargets, extendPath } from '../src/combat/rules.js';
import { RoomCombat } from '../src/net/combat.js';
import { TitusCombat } from '../src/combat/TitusCombat.js';

const at = (x, y, name = `${x},${y}`) => ({ x, y, name });
const names = (list) => list.map(t => t.name);
// Rotate a right-facing offset [forward, across] into another facing.
const toward = (facing, forward, across = 0) => {
  const [fx, fy] = DIRECTIONS[facing];
  return [100 + forward * fx - across * fy, 100 + forward * fy + across * fx];
};

// ---- geometry -------------------------------------------------------------------------------------

test('the zone credits the defender body on every side, in every facing', () => {
  for (const [name, spec] of Object.entries(ATTACKS).filter(([, spec]) => !spec.radial)) for (const facing of Object.keys(DIRECTIONS)) {
    const width = (spec.width ?? 18) + BODY, source = at(100, 100);
    const hit = (forward, across) => attackTargets(source, [at(...toward(facing, forward, across))], facing, spec).length === 1;
    const label = `${name} ${facing}`;
    assert.ok(hit(0, 0), `${label}: overlapping`);
    assert.ok(hit(-BODY, 0), `${label}: body just behind the centre`);
    assert.ok(hit(spec.reach + BODY, 0), `${label}: tip of the reach`);
    assert.ok(hit(spec.reach / 2, width), `${label}: edge of the width`);
    assert.ok(hit(spec.reach / 2, -width), `${label}: other edge of the width`);
    assert.ok(!hit(-BODY - 1, 0), `${label}: behind`);
    assert.ok(!hit(spec.reach + BODY + 1, 0), `${label}: out of reach`);
    assert.ok(!hit(spec.reach / 2, width + 1), `${label}: off to the side`);
  }
});

test('a lunge that carries the attacker through someone still hits them', () => {
  // Kick lunging right from x=100 to x=150 over a target standing at 110: the target ends up 40px
  // behind the attacker's centre, out of the zone at the strike, but the swing passed over them.
  const target = at(110, 100), spec = ATTACKS.kick;
  assert.deepEqual(attackTargets(at(150, 100), [target], 'right', spec), [], 'the strike position alone misses');
  assert.deepEqual(attackTargets(at(150, 100), [target], 'right', spec, [at(100, 100)]), [target]);
  // Fine-grained samples, a single coarse step and a curved walk all cover the same ground.
  const steps = []; for (let x = 100; x < 150; x += 7) steps.push(at(x, 100));
  assert.deepEqual(attackTargets(at(150, 100), [target], 'right', spec, steps), [target]);
  assert.deepEqual(attackTargets(at(150, 110), [target], 'right', spec, [at(100, 90), at(125, 100)]), [target]);
  for (const facing of Object.keys(DIRECTIONS)) {
    const passed = at(...toward(facing, 10)), start = at(...toward(facing, 0)), end = at(...toward(facing, 50));
    assert.deepEqual(attackTargets(end, [passed], facing, spec, [start]), [passed], facing);
  }
});

test('the swept zone stays a zone: behind the start, beside the path and beyond the tip miss', () => {
  const spec = ATTACKS.kick, path = [at(100, 100)], end = at(150, 100), width = spec.width + BODY;
  for (const [x, y] of [[100 - BODY - 1, 100], [125, 100 + width + 1], [125, 100 - width - 1], [150 + spec.reach + BODY + 1, 100]])
    assert.deepEqual(attackTargets(end, [at(x, y)], 'right', spec, path), [], `${x},${y}`);
  // Walking sideways while punching right sweeps the zone sideways, never backwards.
  assert.equal(attackTargets(at(100, 140), [at(105, 120)], 'right', ATTACKS.punch, [at(100, 100)]).length, 1);
  assert.equal(attackTargets(at(100, 140), [at(80, 120)], 'right', ATTACKS.punch, [at(100, 100)]).length, 0);
});

test('targets come back nearest the strike first', () => {
  const near = at(120, 100, 'near'), far = at(140, 100, 'far'), passed = at(105, 100, 'passed');
  assert.deepEqual(names(attackTargets(at(100, 100), [far, near], 'right', ATTACKS.kick)), ['near', 'far']);
  assert.deepEqual(names(attackTargets(at(125, 100), [far, passed, near], 'right', ATTACKS.kick, [at(100, 100)])), ['near', 'far', 'passed']);
});

test('extendPath keeps distinct positions as copies', () => {
  const p = at(1, 2), path = extendPath([], p);
  extendPath(path, p); p.x = 5; extendPath(path, p);
  assert.deepEqual(path, [{ x: 1, y: 2 }, { x: 5, y: 2 }]);
});

// ---- host -----------------------------------------------------------------------------------------

function room(ax, bx) {
  const r = new RoomCombat(), p = { a: { x: ax, y: 100, level: 'brock3' }, b: { x: bx, y: 100, level: 'brock3' } };
  r.tick(p, 0);
  return { r, p, attack: (name, facing = 'right', n = 1, now = 0) => r.command('a', { action: name, facing, n }, now) };
}

test('host: every attack lands on a defender the lunge carried the attacker past', () => {
  for (const [name, spec] of Object.entries(ATTACKS)) {
    if (spec.character) continue;
    const { r, p, attack } = room(100, 104);
    attack(name);
    // Snapshots every 66ms, as the host sends them; the attacker lunges 250px/s through windup+active.
    let health = 125;
    for (let now = 66; now <= 1200; now += 66) {
      if (now <= spec.frames[0] + spec.frames[1]) p.a.x = 100 + 0.25 * now;
      health = r.tick(p, now).fighters.b.health;
    }
    assert.ok(p.a.x - p.b.x > BODY, `${name}: the attacker really ended up past the defender`);
    assert.equal(health, 125 - spec.damage, name);
  }
});

test('host: a lunge cannot tunnel through a defender between two snapshots', () => {
  const { r, p, attack } = room(100, 130);
  attack('headbutt');
  r.tick(p, 140);                 // still winding up at 100
  p.a.x = 200;                    // the next snapshot is already 70px further on
  assert.equal(r.tick(p, 206).fighters.b.health, 115);
});

test('host: stepping out of the swept zone during the wind-up still dodges', () => {
  const { r, p, attack } = room(100, 120);
  attack('kick');
  p.b.y = 150; r.tick(p, 66);     // sidestep before the strike
  p.a.x = 130; r.tick(p, 132);
  assert.equal(r.tick(p, 198).fighters.b.health, 125);
  const back = room(100, 120);
  back.attack('kick');
  back.p.b.x = 200; back.r.tick(back.p, 66);   // backstep out of reach
  assert.equal(back.r.tick(back.p, 198).fighters.b.health, 125);
});

test('host: a swept hit lands once, and the path starts fresh each swing', () => {
  const { r, p, attack } = room(100, 104);
  attack('punch');
  p.a.x = 130; r.tick(p, 66);
  assert.equal(r.tick(p, 132).fighters.b.health, 121);
  assert.equal(r.tick(p, 198).fighters.b.health, 121);
  // Next punch starts at 130, so the defender at 104 is now behind the whole swing.
  attack('punch', 'right', 2, 400);
  r.tick(p, 466); r.tick(p, 532);
  assert.equal(r.tick(p, 600).fighters.b.health, 121);
});

// ---- local client (TitusCombat on a fake scene, stepped one 60fps frame at a time) ---------------

function arena(character, speed, options = {}) {
  const listeners = {}, sceneEvents = {}, now = { t: 0 };
  const on = (bag) => (event, fn) => { (bag[event] ??= []).push(fn); };
  const scene = {
    time: { get now() { return now.t; } },
    anims: { exists: () => true },
    input: { keyboard: { addKeys: () => Object.fromEntries('CXZVS'.split('').map(k => [k, { isDown: false }])) } },
    events: { on: on(sceneEvents), once: on(sceneEvents), off() {} },
    // Hit boxes exist only on active frames, like the exported art.
    cache: { json: { get: () => ({ frames: { active: { pixelforge: { hit: [[0, 0, 4, 4]] } } } }) } },
  };
  const hits = [];
  const target = { active: true, x: 0, y: 0, actor: { hit: (from, spec) => { hits.push(spec); return { damage: spec.damage }; } } };
  const sprite = {
    scene, active: true, x: 0, y: 0, texture: { key: character }, frame: { name: 'idle', realWidth: 64, realHeight: 64 },
    originX: 0.5, originY: 0.8, flipX: false, flipY: false, scaleX: 1, scaleY: 1, rotation: 0,
    body: { velocity: { x: 0, y: 0, length() { return Math.hypot(this.x, this.y); } }, setVelocity(x, y) { this.velocity.x = x; this.velocity.y = y; } },
    on: on(listeners), off() {}, emit(event, ...args) { for (const fn of listeners[event] ?? []) fn(...args); },
    setFlipX(v) { this.flipX = v; return this; }, setDepth() { return this; }, play() { return this; },
    controller: {
      opts: { speed }, facing: 'right', override: {}, keys: {}, busy: null, stunnedUntil: 0,
      readInput() { return { left: false, right: false, up: false, down: false, ...this.override }; }, update(t) { if (t < this.stunnedUntil) return; this.updateTopdown(this.readInput()); },
      updateTopdown(input) {
        const dx = Number(!!input.right) - Number(!!input.left), dy = Number(!!input.down) - Number(!!input.up);
        sprite.body.setVelocity(dx * speed, dy * speed);
      },
      stun(ms) { this.stunnedUntil = now.t + ms; },
    },
  };
  const combat = new TitusCombat(scene, sprite, { targets: () => [target], ...options });
  // One frame: controller, physics, the frame the animation is on, then postupdate hit checks.
  const step = (input) => {
    now.t += 1000 / 60;
    sprite.controller.override = input;
    sprite.controller.update(now.t);
    sprite.x += sprite.body.velocity.x / 60; sprite.y += sprite.body.velocity.y / 60;
    const attack = combat.rules.attack;
    if (attack) {
      const [windup, active, ...rest] = ATTACKS[attack.name].frames, t = now.t - attack.start;
      sprite.frame.name = t >= windup && t < windup + active ? 'active' : 'other';
      if (t >= windup + active + rest[0] + rest[1]) sprite.emit('animationcomplete', { key: sprite.controller.busy });
    } else sprite.frame.name = 'idle';
    for (const fn of sceneEvents.postupdate ?? []) fn();
  };
  const fight = (input, ms) => { for (let t = 0; t < ms; t += 1000 / 60) step(input); };
  return { sprite, target, combat, hits, step, fight };
}

test('local: walking into a fighter and attacking hits them even after lunging through', () => {
  for (const [character, speed] of [['mason', 180], ['titus', 140]]) for (const facing of Object.keys(DIRECTIONS)) {
    for (const name of ['punch', 'kick', 'headbutt']) {
      const { sprite, target, hits, fight, combat } = arena(character, speed);
      const [fx, fy] = DIRECTIONS[facing];
      // Overlapping: the swing's lunge carries the attacker well past before the active frames.
      Object.assign(target, { x: 2 * fx, y: 2 * fy });
      sprite.controller.facing = facing;
      fight({ [name]: true, [facing]: true }, 34);
      fight({ [facing]: true }, 1200);
      const label = `${character} ${name} ${facing}`;
      const ended = (sprite.x - target.x) * fx + (sprite.y - target.y) * fy;
      assert.ok(ended > BODY, `${label}: really lunged past (${ended.toFixed(1)}px)`);
      assert.equal(combat.rules.attack, null, `${label}: swing finished`);
      assert.deepEqual(hits.map(s => s.damage), [characterAttack(character,name).damage], label);
    }
  }
});

test('local: the hit waits for the active frames and lands once per swing', () => {
  const { target, hits, step, combat } = arena('mason', 180);
  Object.assign(target, { x: 20, y: 0 });
  step({ kick: true });
  while (combat.rules.attack && combat.sprite.frame.name !== 'active') { assert.equal(hits.length, 0, 'no hit in the wind-up'); step({}); }
  assert.equal(hits.length, 1, 'hit on the first active frame');
  while (combat.rules.attack) step({});
  assert.equal(hits.length, 1);
});

test('local: a fighter who steps out of the swept zone during the wind-up is not hit', () => {
  const { target, hits, step, fight, combat } = arena('titus', 140);
  Object.assign(target, { x: 20, y: 0 });
  step({ kick: true });
  target.y = 60;                    // sidestep
  while (combat.rules.attack) step({ right: true });
  assert.deepEqual(hits, []);
  // And one well behind the attacker is out of the swing and out of the facing assist's reach.
  Object.assign(target, { x: combat.sprite.x - 80, y: combat.sprite.y });
  fight({}, 200); step({ punch: true });
  while (combat.rules.attack) step({ right: true });
  assert.deepEqual(hits, []);
});

test('local: a swing that would whiff turns toward an opponent in range and still sweeps', () => {
  const { sprite, target, hits, step, combat } = arena('mason', 180);
  Object.assign(target, { x: 0, y: 35 });       // below and out of the right-facing zone
  assert.equal(attackTargets(sprite, [target], 'right', ATTACKS.headbutt).length, 0);
  step({ headbutt: true });
  assert.equal(combat.rules.attack.facing, 'down');
  while (combat.rules.attack) step({ down: true });
  assert.ok(sprite.y - target.y > BODY, 'lunged down past them');
  assert.deepEqual(hits.map(s => s.damage), [characterAttack('mason','headbutt').damage]);
});

test('punches alternate hands facing up and down, when the character has the other hand', () => {
  const has = key => key.startsWith('titus_punch_alt_');
  assert.deepEqual([0, 1, 2, 3].map(n => attackAnim('titus', 'punch', 'down', n, has)),
    ['titus_punch_down', 'titus_punch_alt_down', 'titus_punch_down', 'titus_punch_alt_down']);
  assert.equal(attackAnim('titus', 'punch', 'up', 1, has), 'titus_punch_alt_up');
  assert.equal(attackAnim('titus', 'punch', 'left', 1, has), 'titus_punch_side', 'side punches keep the near hand');
  assert.equal(attackAnim('titus', 'kick', 'down', 1, has), 'titus_kick_down');
  assert.equal(attackAnim('mason', 'punch', 'down', 1, () => false), 'mason_punch_down', 'no alt art: same punch');
});

test('local: a swing that touches nobody whiffs once its active frames end; a hit never whiffs', () => {
  const whiffs = [];
  const miss = arena('titus', 140, { onWhiff: (s, move, facing) => whiffs.push([move, facing, s.controller.facing]) });
  Object.assign(miss.target, { x: 300, y: 0 });
  miss.step({ punch: true });
  while (miss.combat.rules.attack && miss.sprite.frame.name !== 'active') miss.step({});
  assert.deepEqual(whiffs, [], 'not during the active frames');
  while (miss.combat.rules.attack) miss.step({});
  assert.deepEqual(whiffs.map(w => w.slice(0, 2)), [['punch', 'right']]);
  const hit = arena('titus', 140, { onWhiff: () => whiffs.push('hit') });
  Object.assign(hit.target, { x: 20, y: 0 });
  hit.step({ punch: true });
  while (hit.combat.rules.attack) hit.step({});
  assert.equal(hit.hits.length, 1); assert.equal(whiffs.length, 1);
  // Online: a swing that visibly reaches another player isn't a whiff, even though the host judges it.
  const online = arena('titus', 140, { onWhiff: () => whiffs.push('online'), others: () => [{ active: true, x: 20, y: 0 }] });
  Object.assign(online.target, { x: 300, y: 0 });
  online.step({ punch: true });
  while (online.combat.rules.attack) online.step({});
  assert.equal(whiffs.length, 1);
});

test('local: a hit flinches the victim, then slides them its knockback distance after the freeze', () => {
  for (const name of ['punch', 'kick']) {
    const { sprite, combat, step } = arena('titus', 140);
    combat.rules.update(0, { punch: true }, 'right');
    const spec = ATTACKS[name], start = sprite.x;
    sprite.hitFreeze = { until: 1 };   // as hitFeel.js leaves it
    const result = combat.receive({ x: sprite.x - 20, y: 0 }, spec);
    assert.equal(combat.rules.attack, null, `${name}: own swing cancelled`);
    step({ right: true });
    assert.equal(sprite.x, start, 'held while frozen');
    delete sprite.hitFreeze;
    for (let t = 0; t < spec.slide + 50; t += 1000 / 60) step({ right: true });
    const moved = sprite.x - start;
    assert.ok(Math.abs(moved - spec.knockback) <= 1.5, `${name}: slid ${moved.toFixed(1)}px for ${spec.knockback}`);
    assert.equal(sprite.controller.facing, 'left', 'turned to face the hit');
    assert.ok(sprite.controller.stunnedUntil >= result.stagger - 20, 'the arrows cannot steer out of the flinch');
  }
});
