import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRules, HealthPool, ATTACKS, BLOCK, BUFFER_MS, DODGE, MASH, PARRY, aimFacing } from '../src/combat/rules.js';
import { GrappleHold } from '../src/combat/grapple.js';
import { RoomCombat } from '../src/net/combat.js';
import { LAYOUTS, ALL_KEYS, keyLabel } from '../src/controls.js';

// ---- P0: the buffer ----------------------------------------------------------------------------------

test('a press made during a swing fires on the first free frame, within 150 ms', () => {
  const r = new CombatRules(new HealthPool(), 'titus');
  r.update(0, { punch: true }, 'right');
  r.update(200, { kick: true }, 'right');            // still punching: remembered
  assert.equal(r.attack.name, 'punch');
  r.finishAttack();
  r.update(300, { kick: true }, 'right');            // free 100 ms after the press, key still held
  assert.equal(r.attack?.name, 'kick');
});

test('a press older than the buffer is dropped, and a held key never repeats', () => {
  const r = new CombatRules(new HealthPool(), 'titus');
  r.update(0, { punch: true }, 'right');
  r.update(100, { punch: true }, 'right');           // the same press, held: not a new one
  r.update(150, {}, 'right');
  r.update(160, { kick: true }, 'right');
  r.finishAttack();
  r.update(160 + BUFFER_MS + 1, {}, 'right');        // free just too late
  assert.equal(r.attack, null);
  r.update(400, { punch: true }, 'right');
  r.finishAttack();
  r.update(1000, { punch: true }, 'right');          // held all along
  assert.equal(r.attack, null, 'holding punch through the end of a punch does not throw another');
});

test('only the latest press is kept', () => {
  const r = new CombatRules(new HealthPool(), 'titus');
  r.update(0, { punch: true }, 'right');
  r.update(100, { kick: true }, 'right');
  r.update(120, {}, 'right');
  r.update(140, { headbutt: true }, 'right');
  r.finishAttack();
  r.update(200, {}, 'right');
  assert.equal(r.attack.name, 'headbutt');
});

test('a press during a hit\'s flinch fires as the flinch ends', () => {
  const r = new CombatRules(new HealthPool(), 'titus');
  const hit = r.receive(ATTACKS.punch, 'right', 0);
  r.watch(hit.stagger - 50, { punch: true });         // what TitusCombat does while the controller is stunned
  r.update(hit.stagger, { punch: true }, 'right');
  assert.equal(r.attack?.name, 'punch');
});

test('the host holds a press that arrives a moment before it thinks the last move is over', () => {
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3' }, b: { x: 300, y: 100, level: 'brock3' } };
  room.tick(p, 0);
  room.command('a', { action: 'punch', facing: 'right', n: 1 }, 0);
  room.command('a', { action: 'kick', facing: 'right', n: 2 }, 300);   // the punch lasts 320 ms here
  assert.equal(room.fighters.get('a').action.name, 'punch');
  room.tick(p, 330);
  assert.equal(room.fighters.get('a').action?.name, 'kick', 'fired once the punch ended');
  room.command('a', { action: 'punch', facing: 'right', n: 3 }, 400);
  room.tick(p, 400 + BUFFER_MS + 600);
  assert.notEqual(room.fighters.get('a').action?.name, 'punch', 'a press older than the buffer is dropped');
});

// ---- P0: tap aims at the nearest --------------------------------------------------------------------

test('a tap faces the nearest opponent within 1.5x reach, by the stronger axis', () => {
  const me = { x: 100, y: 100 }, punch = ATTACKS.punch;
  assert.equal(aimFacing(me, [{ x: 100, y: 140 }, { x: 160, y: 100 }], punch), 'down');
  assert.equal(aimFacing(me, [{ x: 70, y: 90 }], punch), 'left');
  assert.equal(aimFacing(me, [{ x: 100, y: 40 }], punch), 'up');
  assert.equal(aimFacing(me, [{ x: 200, y: 100 }], punch), null, 'too far: keep your own facing');
  assert.equal(aimFacing(me, [{ x: 100, y: 40 }], ATTACKS.bellow), null, 'radial moves need no facing');
});

test('a held direction overrides the aim; a diagonal picks the side with someone in range', () => {
  const me = { x: 100, y: 100 }, punch = ATTACKS.punch;
  assert.equal(aimFacing(me, [{ x: 100, y: 130 }], punch, ['left']), 'left');
  assert.equal(aimFacing(me, [{ x: 100, y: 125 }], punch, ['right', 'down']), 'down');
  assert.equal(aimFacing(me, [], punch, ['right', 'down']), 'right');
});

// ---- P0: block in a crowd ---------------------------------------------------------------------------

test('a perfect block in the first 120 ms takes nothing and staggers the attacker', () => {
  const guard = new CombatRules(), attacker = new CombatRules();
  guard.update(0, { block: true }, 'right');
  attacker.update(0, { punch: true }, 'left');
  const r = guard.receive(ATTACKS.headbutt, 'up', BLOCK.perfect - 1);   // from the side: still covered
  assert.deepEqual([r.perfect, r.damage, r.stagger], [true, 0, 0]);
  const p = attacker.parried(BLOCK.perfect - 1);
  assert.equal(attacker.attack, null);
  assert.equal(attacker.staggerUntil, BLOCK.perfect - 1 + PARRY.stagger);
  assert.equal(p.parried, true);
  const late = guard.receive(ATTACKS.headbutt, 'right', BLOCK.perfect);
  assert.equal(late.perfect, undefined);
  assert.equal(late.damage, 2.5, 'after the window it is an ordinary block');
});

test('mashing block still only earns one perfect window a second', () => {
  const guard = new CombatRules();
  guard.update(0, { block: true }, 'right');
  guard.update(50, {}, 'right');
  guard.update(60, { block: true }, 'right');
  assert.equal(guard.block, null, 'a second block waits out the cooldown');
  assert.equal(guard.blockReadyAt, 50 + BLOCK.cooldown);
});

test('the host: a perfect block staggers the attacker and tells both screens', () => {
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3' }, b: { x: 120, y: 100, level: 'brock3' } };
  room.tick(p, 0);
  room.command('b', { action: 'block', facing: 'up', n: 1 }, 0);      // facing up: a punch from the side is covered
  room.command('a', { action: 'punch', facing: 'right', n: 1 }, 0);
  const { hits } = room.tick(p, 80);
  assert.equal(room.fighters.get('b').rules.health.value, 125);
  assert.deepEqual(hits.map(h => [h.target, h.move, !!h.perfect, !!h.parried]), [['b', 'punch', true, false], ['a', 'parry', false, true]]);
  assert.equal(room.fighters.get('a').action, null);
  room.command('a', { action: 'kick', facing: 'right', n: 2 }, 200);
  assert.equal(room.fighters.get('a').action, null, 'staggered');
});

test('the host judges the perfect window when the swing connected, not when its tick came round', () => {
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3' }, b: { x: 120, y: 100, level: 'brock3' } };
  room.tick(p, 0);
  room.command('b', { action: 'block', facing: 'left', n: 1 }, 0);
  room.command('a', { action: 'punch', facing: 'right', n: 1 }, 0);
  const { hits } = room.tick(p, 150);   // a slow tick: the punch went live at 70, inside the window
  assert.ok(hits.some(h => h.target === 'b' && h.perfect));
  assert.equal(room.fighters.get('b').rules.health.value, 125);
});

// ---- P1: dodge --------------------------------------------------------------------------------------

test('the dodge goes where the arrows point, is untouchable for 150 ms and cools down', () => {
  const r = new CombatRules();
  r.update(0, { dodge: true, up: true, right: true }, 'down');
  assert.ok(Math.abs(r.dodge.dx - Math.SQRT1_2) < 1e-9 && Math.abs(r.dodge.dy + Math.SQRT1_2) < 1e-9);
  assert.equal(r.receive(ATTACKS.headbutt, 'left', DODGE.invulnerable - 1).dodged, true);
  assert.equal(r.health.value, 125);
  r.update(DODGE.duration, {}, 'down');
  assert.equal(r.dodge, null);
  r.update(DODGE.duration + 10, { dodge: true }, 'down');
  assert.equal(r.dodge, null, 'cooling down');
  r.update(DODGE.cooldown, {}, 'down'); r.update(DODGE.cooldown + 1, { dodge: true }, 'left');
  assert.deepEqual([r.dodge.dx, r.dodge.dy], [-1, 0], 'no arrows: straight ahead');
  assert.equal(r.receive(ATTACKS.punch, 'left', DODGE.cooldown + DODGE.invulnerable + 2).damage, 4, 'hittable after the window');
});

test('a dodge gets you out of a block, and the host honours it', () => {
  const r = new CombatRules();
  r.update(0, { block: true }, 'right');
  r.update(200, { block: true, dodge: true }, 'right');
  assert.equal(r.block, null); assert.ok(r.dodge);
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3' }, b: { x: 120, y: 100, level: 'brock3' } };
  room.tick(p, 0);
  room.command('b', { action: 'dodge', facing: 'down', n: 1 }, 0);
  room.command('a', { action: 'punch', facing: 'right', n: 1 }, 0);
  room.tick(p, 100);
  assert.equal(room.fighters.get('b').rules.health.value, 125);
});

// ---- P1: mash out ------------------------------------------------------------------------------------

test('Grapple: every press takes 120 ms off, never under 600 ms of hold, and the choke still lands', () => {
  const mason = new CombatRules(undefined, 'mason'), victim = new CombatRules();
  mason.update(0, { grapple: true }, 'right');
  const hold = new GrappleHold(mason, victim, mason.attack, 500);
  const natural = hold.until;
  hold.mash(600);
  assert.equal(hold.until, natural - MASH.grapple);
  for (let t = 650; t < 900; t += 10) hold.mash(t);
  assert.equal(hold.until, 500 + MASH.grappleFloor);
  assert.equal(hold.update(1099), 'holding');
  assert.equal(hold.update(1100), 'damage');
  assert.equal(victim.heldBy, null);
  assert.equal(victim.grabImmuneUntil, 1100 + MASH.regrab);
});

test('Bellow: every press takes 150 ms off the stun and its flinch, never under 1 s', () => {
  const r = new CombatRules();
  r.receive(ATTACKS.bellow, 'left', 0);
  assert.equal(r.stunUntil, 5000);
  r.shakeOff(100);
  assert.equal(r.stunUntil, 5000 - MASH.stun);
  assert.equal(r.staggerUntil, 5000 - MASH.stun);
  for (let t = 200; t < 1000; t += 20) r.shakeOff(t);
  assert.equal(r.stunUntil, MASH.stunFloor);
  assert.equal(r.shakeOff(1500), false, 'nothing to shake once it is over');
});

test('the host shortens holds and stuns, counts presses no closer than 50 ms, and stops regrabs for a second', () => {
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3', char: 'mason' }, b: { x: 118, y: 100, level: 'brock3' } };
  room.tick(p, 0);
  room.command('a', { action: 'grapple', facing: 'right', n: 1 }, 0);
  for (const t of [66, 132, 198, 264, 330, 396, 462, 528]) room.tick(p, t);
  const hold = room.fighters.get('a').hold.hold, natural = hold.until;
  room.command('b', { action: 'mash', n: 1 }, 530);
  room.command('b', { action: 'mash', n: 2 }, 540);   // 10 ms later: the same press as far as the host cares
  assert.equal(hold.until, natural - MASH.grapple);
  let n = 3, hits = [];
  for (let t = 600; t <= 2000; t += 66) { room.command('b', { action: 'mash', n: n++ }, t); hits.push(...room.tick(p, t).hits); }
  const choke = hits.find(h => h.move === 'grapple');
  assert.ok(choke && choke.damage === 25, 'the choke lands when the shortened hold ends');
  assert.ok(room.fighters.get('a').action === null || room.fighters.get('a').action.start < 0, 'the holder skips to its recovery');
  room.fighters.get('a').rules.readyAt.grapple = 0;
  const freed = room.fighters.get('b').rules.grabImmuneUntil;
  room.command('a', { action: 'grapple', facing: 'right', n: 2 }, freed - 600);
  for (let t = freed - 600; t < freed - 100; t += 66) room.tick(p, t);
  assert.equal(room.fighters.get('a').hold ?? null, null, 'no regrab inside the second');
});

// ---- P2: keyboard layouts ---------------------------------------------------------------------------

test('two keyboard layouts that never share a key between moves', () => {
  for (const l of Object.values(LAYOUTS)) {
    const used = [l.punch, l.kick, l.headbutt, l.block, l.super, l.dodge, ...Object.values(l.move).flat()];
    assert.equal(new Set(used).size, used.length, `${l.name}: one job per key`);
  }
  assert.deepEqual([LAYOUTS.wasd.punch, LAYOUTS.wasd.kick, LAYOUTS.wasd.headbutt, LAYOUTS.wasd.block, LAYOUTS.wasd.super, LAYOUTS.wasd.dodge], ['J', 'K', 'L', 'I', 'U', 'SPACE']);
  assert.ok(ALL_KEYS.includes('SHIFT') && ALL_KEYS.includes('W'));
  assert.equal(keyLabel('SHIFT'), 'Shift');
});
