import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCombat } from '../src/net/combat.js';
import { KO, leaderOf, koAlpha } from '../src/combat/match.js';

// A KO counts: the host credits it, keeps the session's tally, and brings the fighter back safe for a moment.
const big = { damage: 999, knockback: 0, stagger: 0 }, nick = { damage: 5, knockback: 0, stagger: 0 };
function setup() {
  const room = new RoomCombat({ walls: () => null });
  const p = { a: { x: 100, y: 100, level: 'brock3', name: 'Mason' }, b: { x: 120, y: 100, level: 'brock3', name: 'Titus' },
              c: { x: 300, y: 100, level: 'brock3', name: 'James' } };
  room.tick(p, 0);
  return { room, p };
}
const ko = (room, p, victim, by, now) => { room.damage(victim, by, big, by ? p[by] : null, now, 'punch'); return room.tick(p, now); };

test('the finishing player gets the KO: the hit says ko, the snapshot names who, the tally counts it', () => {
  const { room, p } = setup();
  const s = ko(room, p, 'b', 'a', 10);
  assert.equal(s.hits[0].ko, true);
  assert.deepEqual(s.kos, [{ victim: 'b', by: 'a', move: 'punch', ended: 0, victimName: 'Titus', byName: 'Mason' }]);
  assert.equal(s.fighters.b.ko.by, 'a');
  assert.equal(s.fighters.b.ko.facing, 'left');   // toward the attacker
  assert.equal(s.fighters.b.ko.left, KO.respawn);
  assert.deepEqual(s.fighters.a.score, { kos: 1, falls: 0, streak: 1 });
  assert.deepEqual(s.fighters.b.score, { kos: 0, falls: 1, streak: 0 });
  assert.equal(s.leader, 'a');
  assert.equal(room.tick(p, 20).kos.length, 0);   // each KO is sent once
});

test('a hazard finishing someone credits the last player to hurt them within 5 s, else nobody', () => {
  const { room, p } = setup();
  room.damage('b', 'a', nick, p.a, 0, 'punch');
  let s = ko(room, p, 'b', null, KO.credit);
  assert.equal(s.kos[0].by, 'a');
  assert.equal(s.fighters.a.score.kos, 1);
  room.tick(p, KO.credit + KO.respawn);   // back
  const back = KO.credit + KO.respawn + KO.safe;
  room.damage('b', 'a', nick, p.a, back, 'punch');
  s = ko(room, p, 'b', null, back + KO.credit + 1);
  assert.equal(s.kos[0].by, null);
  assert.equal(s.fighters.a.score.kos, 1);
  assert.equal(s.fighters.b.score.falls, 2);
});

test('a third player finishing the fight gets the KO', () => {
  const { room, p } = setup();
  room.damage('b', 'a', nick, p.a, 0, 'kick');
  const s = ko(room, p, 'b', 'c', 100);
  assert.equal(s.kos[0].by, 'c');
  assert.equal(s.fighters.c.score.kos, 1);
  assert.equal(s.fighters.a.score.kos, 0);
});

test('a KO happens once, the fighter respawns after KO.respawn, then is untouchable until KO.safe or their own swing', () => {
  const { room, p } = setup();
  ko(room, p, 'b', 'a', 0);
  room.damage('b', 'a', big, p.a, 50, 'punch');   // already down
  assert.equal(room.tick(p, 60).fighters.b.score.falls, 1);
  assert.equal(room.tick(p, KO.respawn - 1).fighters.b.life, 0);
  let s = room.tick(p, KO.respawn);
  assert.equal(s.fighters.b.life, 1);
  assert.equal(s.fighters.b.ko, null);
  assert.equal(s.fighters.b.safe, KO.safe);
  // A punch that would land does nothing, and a hazard neither.
  room.command('a', { action: 'punch', facing: 'right', n: 1 }, KO.respawn + 10);
  room.tick(p, KO.respawn + 80); s = room.tick(p, KO.respawn + 200);
  room.command('b', { action: 'hazard', n: 1 }, KO.respawn + 210);
  s = room.tick(p, KO.respawn + 220);
  assert.equal(s.fighters.b.health, s.fighters.b.maxHealth);
  // Their own swing gives it up.
  room.command('b', { action: 'punch', facing: 'left', n: 2 }, KO.respawn + 400);
  assert.equal(room.tick(p, KO.respawn + 410).fighters.b.safe, 0);
  room.damage('b', 'a', nick, p.a, KO.respawn + 420, 'punch');
  assert.ok(room.tick(p, KO.respawn + 430).fighters.b.health < s.fighters.b.maxHealth);
});

test('three KOs without falling make a streak; ending it is worth a bonus KO', () => {
  const { room, p } = setup();
  let t = 0;
  for (let i = 0; i < 3; i++) { ko(room, p, 'b', 'a', t); room.tick(p, t + KO.respawn); t += KO.respawn + KO.safe + 10; }
  let s = room.tick(p, t);
  assert.deepEqual(s.fighters.a.score, { kos: 3, falls: 0, streak: 3 });
  s = ko(room, p, 'a', 'c', t + 10);
  assert.equal(s.kos[0].ended, 3);
  assert.deepEqual(s.fighters.c.score, { kos: 2, falls: 0, streak: 1 });
  assert.deepEqual(s.fighters.a.score, { kos: 3, falls: 1, streak: 0 });
  assert.equal(s.leader, 'a');   // 3 KOs still lead 2
});

test('the leader has the most KOs; a tie keeps whoever got there first', () => {
  assert.equal(leaderOf([['a', { kos: 0, at: 0 }]]), null);
  assert.equal(leaderOf([['a', { kos: 2, at: 50 }], ['b', { kos: 2, at: 10 }], ['c', { kos: 1, at: 0 }]]), 'b');
  assert.equal(leaderOf([['a', { kos: 3, at: 50 }], ['b', { kos: 2, at: 10 }]]), 'a');
});

test('a KO\'d body lies still, then fades out', () => {
  assert.equal(koAlpha(0), 1);
  assert.equal(koAlpha(KO.fadeAfter), 1);
  assert.equal(koAlpha(KO.fadeAfter + KO.fade / 2), 0.5);
  assert.equal(koAlpha(KO.fadeAfter + KO.fade), 0);
  assert.ok(KO.fadeAfter + KO.fade < KO.respawn);
});
