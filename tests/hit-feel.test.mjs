import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, CombatRules, pushSpeed } from '../src/combat/rules.js';
import { HitFeel, HIT_FEEL, freezeTime } from '../src/combat/hitFeel.js';
import { RoomCombat } from '../src/net/combat.js';

test('every hit interrupts: a clean punch or kick cancels the victim\'s own wind-up', () => {
  for (const name of ['punch', 'kick']) {
    const victim = new CombatRules();
    victim.update(0, { punch: true }, 'left');
    assert.equal(victim.attack.name, 'punch');
    const r = victim.receive(ATTACKS[name], 'right', 30);
    assert.ok(r.stagger > HIT_FEEL[name].freeze, `${name}: the flinch outlasts the freeze`);
    assert.equal(victim.attack, null, `${name}: wind-up cancelled, no trade`);
    assert.equal(victim.hurtFacing, 'right', 'flinches toward the hit');
    victim.update(30 + r.stagger - 1, {}, 'left'); victim.update(30 + r.stagger - 1, { punch: true }, 'left');
    assert.equal(victim.attack, null, `${name}: can't act during the flinch`);
  }
  const guard = new CombatRules();
  guard.update(0, { block: true }, 'right');
  const blocked = guard.receive(ATTACKS.punch, 'right', 200);
  assert.equal(blocked.stagger, 0, 'a blocked hit does not flinch');
  assert.equal(blocked.knockback, ATTACKS.punch.knockback * 0.25);
});

test('knockback slides its distance, fast at first and easing out', () => {
  for (const [name, lo, hi] of [['punch', 6, 8], ['kick', 14, 16]]) {
    const { knockback, slide } = ATTACKS[name], v0 = pushSpeed(knockback, slide);
    let x = 0, first = 0, last = 0;
    for (let t = 0; t < slide; t += 1000 / 60) {
      const v = v0 * Math.max(0, 1 - (t + 500 / 60) / slide);   // mid-frame, as TitusCombat.updatePush
      if (!t) first = v; last = v;
      x += v / 60;
    }
    assert.ok(x >= lo - 0.5 && x <= hi + 0.5, `${name} slides ${x.toFixed(1)}px`);
    assert.ok(first > 4 * last, `${name} eases out`);
  }
  assert.equal(pushSpeed(10, 0), 0);
});

test('the freeze scales with the move, shrinks in a crowd and halves when blocked', () => {
  assert.deepEqual(['punch', 'kick', 'headbutt', 'takedown'].map(m => freezeTime(m)), [60, 90, 130, 160]);
  assert.equal(freezeTime('punch', 4), 45);
  assert.equal(freezeTime('kick', 2, true), 45);
  assert.equal(freezeTime(null), 0);
});

function scene() {
  const events = {}, now = { t: 0 }, flashes = [], shakes = [];
  return {
    now, flashes, shakes,
    time: { get now() { return now.t; } },
    events: { on(e, fn, ctx) { (events[e] ??= []).push(fn.bind(ctx)); }, once() {}, off() {} },
    postupdate() { for (const fn of events.postupdate ?? []) fn(); },
    feel: { flash: (s, ms, color) => flashes.push([s.name, color]), shake: (ms, px) => shakes.push([ms, px]) },
    cache: { json: { get: () => null } },   // no effects loaded: sparks are skipped
  };
}
function fighter(name, x) {
  const anims = { isPlaying: true, pause() { this.isPlaying = false; }, resume() { this.isPlaying = true; } };
  return { name, x, y: 100, active: true, anims, texture: { key: 'titus' },
    body: { velocity: { x: 0, y: 0 }, setVelocity(x, y) { this.velocity.x = x; this.velocity.y = y; } },
    setPosition(x, y) { this.x = x; this.y = y; return this; } };
}

test('a hit freezes only the two fighters, shakes the victim in place, then lets the knockback go', () => {
  const s = scene(), me = fighter('me', 100), them = fighter('them', 120), bystander = fighter('bystander', 300);
  const feel = new HitFeel(s, { me: () => me });
  feel.land(me, them, 'kick', { damage: 9 });
  assert.equal(them.anims.isPlaying, false); assert.equal(me.anims.isPlaying, false);
  assert.equal(bystander.anims.isPlaying, true, 'the rest of the brawl keeps moving');
  assert.deepEqual(s.flashes, [['them', 0xffffff]]);
  assert.deepEqual(s.shakes, [HIT_FEEL.kick.shake], 'the attacker\'s camera shakes');
  them.body.setVelocity(150, 0);   // the knockback, set during the freeze
  const xs = [];
  for (let t = 16; t < 90; t += 16) { s.now.t = t; s.postupdate(); xs.push(them.x); assert.equal(me.x, 100); }
  assert.deepEqual([...new Set(xs)].sort(), [119, 121], 'jitters 1px either side');
  assert.equal(them.body.velocity.x, 0, 'held still while frozen');
  s.now.t = 91; s.postupdate();
  assert.equal(them.x, 120); assert.equal(them.anims.isPlaying, true); assert.equal(me.anims.isPlaying, true);
  assert.equal(them.body.velocity.x, 150, 'the push carries on after the freeze');
  assert.equal(them.hitFreeze, undefined);
});

test('only the people in the fight feel the camera shake; blocks and hazards are quieter', () => {
  const s = scene(), me = fighter('me', 0), a = fighter('a', 100), b = fighter('b', 120);
  const feel = new HitFeel(s, { me: () => me });
  feel.land(a, b, 'headbutt', { damage: 10 });
  assert.deepEqual(s.shakes, [], 'a bystander\'s screen stays still');
  feel.land(a, me, 'punch', { damage: 4, blocked: true });
  assert.deepEqual(s.shakes, []);
  assert.deepEqual(s.flashes.at(-1), ['me', 0x77bbff], 'a block flashes blue');
  const c = fighter('c', 0);
  feel.land(null, c, null, { damage: 1 });
  assert.equal(c.hitFreeze, undefined, 'a shower burn only flashes');
  feel.land(a, b, 'punch', { damage: 0 });
  assert.equal(s.flashes.length, 3, 'nothing for a hit that did no damage');
});

test('the host tags each hit with its move and reports which way the victim flinched', () => {
  const room = new RoomCombat({ walls: () => null }), now = 1000;
  const players = { a: { level: 'x', x: 100, y: 100, char: 'titus' }, b: { level: 'x', x: 120, y: 100, char: 'titus' } };
  room.tick(players, now);
  room.command('a', { n: 1, action: 'punch', facing: 'right' }, now);
  let hits = [], snap;
  for (let t = now + 66; t < now + 400 && !hits.length; t += 66) ({ hits, fighters: snap } = room.tick(players, t));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].move, 'punch');
  assert.equal(hits[0].slide, ATTACKS.punch.slide);
  assert.equal(snap.b.hurtFacing, 'left', 'b was hit from its left');
  assert.ok(snap.b.stagger > 0);
});
