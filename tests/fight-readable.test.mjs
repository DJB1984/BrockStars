import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCombat, positionAt, HISTORY_MS, MAX_REWIND } from '../src/net/combat.js';
import { CombatRules, HealthPool, ATTACKS } from '../src/combat/rules.js';

// b walks right out of a's punch: in range (x 120) until t=264, gone (x 200) from t=330. a's punch reaches the\n// host at t=300, so its active frames (370-460 host time) only find b where a's screen showed them.
function walkAway() {
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3' }, b: { x: 120, y: 100, level: 'brock3' } };
  for (const t of [0, 66, 132, 198, 264]) room.tick(p, t);
  p.b.x = 200;
  room.tick(p, 330);
  return { room, p };
}
const punch = (room, seen, now) => room.command('a', { action: 'punch', facing: 'right', n: 1, ...(seen === undefined ? {} : { seen }) }, now);

test('a punch at someone who has since walked away misses without lag compensation', () => {
  const { room, p } = walkAway();
  punch(room, undefined, 300);
  room.tick(p, 396); room.tick(p, 462);
  assert.equal(room.fighters.get('b').rules.health.value, 125);
});

test('the host judges the punch against where the attacker saw them', () => {
  // a's screen showed the world as the host had it at t=150 (150 ms behind): b still at x 120 when the punch came out.
  const { room, p } = walkAway();
  punch(room, 150, 300);
  const hits = [room.tick(p, 396), room.tick(p, 462)].flatMap(s => s.hits);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].target, 'b');
  assert.equal(room.fighters.get('b').rules.health.value, 121);
});

test('an old claim is only believed MAX_REWIND back', () => {
  const room = new RoomCombat(), p = { a: { x: 100, y: 100, level: 'brock3' }, b: { x: 120, y: 100, level: 'brock3' } };
  room.tick(p, 0); room.tick(p, 66);
  p.b.x = 200;
  for (let t = 132; t <= 900; t += 66) room.tick(p, t);
  // "I saw b at t=66" from t=900: 834 ms ago, rewound only 300 ms, to where b had long gone.
  punch(room, 66, 900);
  room.tick(p, 966); room.tick(p, 1032);
  assert.equal(room.fighters.get('b').rules.health.value, 125);
  assert.equal(room.fighters.get('a').action?.rewind ?? MAX_REWIND, MAX_REWIND);
});

test('a claim from the future rewinds nothing', () => {
  const { room, p } = walkAway();
  punch(room, 5000, 300);
  assert.equal(room.fighters.get('a').action.rewind, 0);
  room.tick(p, 396); room.tick(p, 462);
  assert.equal(room.fighters.get('b').rules.health.value, 125);
});

test('position history interpolates, keeps about a second, and resets at a door', () => {
  const room = new RoomCombat(), p = { a: { x: 0, y: 0, level: 'brock3' } };
  for (let t = 0; t <= 2000; t += 50) { p.a.x = t / 10; room.tick(p, t); }
  const h = room.fighters.get('a').history;
  assert.ok(h[0].t >= 2000 - HISTORY_MS - 50 && h[0].t <= 2000 - HISTORY_MS, `oldest sample ${h[0].t}`);
  assert.deepEqual(positionAt(h, 1925, p.a), { x: 192.5, y: 0 });
  assert.equal(positionAt(h, 99999, p.a), p.a);
  p.a.level = 'brock2'; room.tick(p, 2050);
  assert.equal(room.fighters.get('a').history.length, 1);
});

test('pressing a move that is cooling down is a dud; mashing punch is not', () => {
  const rules = new CombatRules(new HealthPool(), 'titus');
  rules.update(0, { kick: true }, 'right');
  assert.equal(rules.attack.name, 'kick'); assert.equal(rules.dud, null);
  rules.finishAttack();
  rules.update(100, {}, 'right');
  rules.update(600, { kick: true }, 'right');
  assert.equal(rules.dud, 'kick');
  rules.update(616, { kick: true }, 'right');
  assert.equal(rules.dud, null, 'a held key is one dud, not one a frame');
  rules.update(700, {}, 'right');
  rules.update(800, { punch: true }, 'right');
  rules.update(816, {}, 'right');
  rules.update(900, { punch: true }, 'right');   // still mid-punch, 300 ms cooldown
  assert.equal(rules.dud, null);
});

test('Block pressed during its cooldown is a dud, and nothing is a dud while stunned', () => {
  const health = new HealthPool(), rules = new CombatRules(health, 'james');
  rules.update(0, { block: true }, 'left');
  rules.update(100, {}, 'left');                   // released: a second's cooldown
  rules.update(300, { block: true }, 'left');
  assert.equal(rules.dud, 'block');
  rules.update(316, {}, 'left');
  rules.readyAt.bellow = 99999;
  health.stunUntil = 5000;
  rules.update(400, { bellow: true }, 'left');
  assert.equal(rules.dud, null);
  health.stunUntil = 0;
  rules.update(416, {}, 'left');
  rules.update(432, { bellow: true }, 'left');
  assert.equal(rules.dud, 'bellow');
  assert.ok(ATTACKS.bellow.cooldown >= 1000);
});
