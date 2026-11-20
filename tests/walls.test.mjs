import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ATTACKS, attackTargets } from '../src/combat/rules.js';
import { RoomCombat } from '../src/net/combat.js';
import { characterStats } from '../src/characters.js';
import { wallGridFromTiled, wallBetween } from '../src/combat/walls.js';

// The real dorm: rooms 7 tiles wide side by side, split by 1-tile walls (x = 40, 48...), with a 2-tile wall
// along their bottom (rows 13-14) broken by a 3-tile doorway (x = 35-37) out to the hall.
const walls = wallGridFromTiled(JSON.parse(fs.readFileSync(new URL('../export/levels/brock3.json', import.meta.url))));
const at = (x, y, name = `${x},${y}`) => ({ x, y, name });

test('the dorm map gives a wall grid', () => {
  assert.equal(walls.cells[6 * walls.width + 40], 1, 'the wall between the first two rooms');
  assert.equal(walls.cells[6 * walls.width + 36], 0, 'floor inside the first room');
});

test('no hit through the wall between two rooms, side by side', () => {
  // feet 8px either side of the 16px wall at x 640-656: 32px apart, well inside a punch
  const a = at(632, 106), b = at(664, 106);
  assert.ok(wallBetween(walls, a, b));
  for (const spec of Object.values(ATTACKS)) {
    assert.deepEqual(attackTargets(a, [b], 'right', spec, [], walls), [], 'through the wall');
    assert.equal(attackTargets(a, [b], 'right', spec, [], null).length, spec.reach + 9 >= 32 ? 1 : 0, 'no walls: in reach');
  }
  // the same distance inside one room still lands
  assert.equal(attackTargets(at(560, 106), [at(592, 106)], 'right', ATTACKS.punch, [], walls).length, 1);
});

test('no hit through a room\'s bottom wall into the hall, but through its doorway yes', () => {
  // wall rows 13-14 are y 208-240; feet above it at 207, below it at 248 (the feet box clears the wall)
  assert.deepEqual(attackTargets(at(536, 207), [at(536, 248)], 'down', ATTACKS.kick, [], walls), [], 'wall');
  assert.equal(attackTargets(at(584, 207), [at(584, 248)], 'down', ATTACKS.kick, [], walls).length, 1, 'doorway');
});

test('a lunge path that ends at the wall still can\'t reach through it', () => {
  const path = [at(600, 106), at(616, 106)];
  assert.deepEqual(attackTargets(at(632, 106), [at(664, 106)], 'right', ATTACKS.headbutt, path, walls), []);
});

test('the host doesn\'t resolve hits through walls', () => {
  const room = new RoomCombat({ walls: (level) => (level === 'brock3' ? walls : null) });
  const p = { a: { x: 632, y: 106, level: 'brock3' }, b: { x: 664, y: 106, level: 'brock3' } };
  room.tick(p, 0);
  room.command('a', { action: 'punch', facing: 'right', n: 1 }, 0);
  room.tick(p, 60);
  const through = room.tick(p, 200);
  assert.equal(through.hits.length, 0);
  const full = characterStats('titus').health;   // fighters default to Titus
  assert.equal(through.fighters.b.health, full);
  // step into the same room: the next punch lands
  p.b.x = 600; p.a.x = 568;
  room.tick(p, 500);
  room.command('a', { action: 'punch', facing: 'right', n: 2 }, 500);
  room.tick(p, 560);
  assert.equal(room.tick(p, 700).fighters.b.health, full - characterStats('titus').punch);
});
