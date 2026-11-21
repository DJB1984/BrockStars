import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerLevelShowers, levelShowers, ShowerWorld, nearestShower } from '../src/showers.js';
import { RoomCombat } from '../src/net/combat.js';
registerLevelShowers('brock3', JSON.parse(readFileSync(new URL('../export/levels/brock3.json', import.meta.url))));
const def = levelShowers('brock3'), shower = def.showers[0];

test('map has 12 individually toggled showers in two isolated bathrooms', () => {
  assert.equal(def.showers.length, 12); assert.equal(def.rooms.length, 2);
  const w = new ShowerWorld();
  assert.deepEqual(w.state('brock3').on, []);
  assert.equal(w.toggle('brock3', {x:0,y:0}), false);
  assert.equal(nearestShower(def, {x:shower.x,y:shower.y-60}), null);
  w.toggle('brock3', shower);
  assert.deepEqual(w.state('brock3').on, [shower.id]);
  assert.equal(w.burning('brock3', shower), true);
  assert.equal(w.burning('brock3', {x:shower.x,y:shower.y+32}), false);
  assert.equal(w.burning('other', shower), false);
  w.update(20000);
  assert.equal(w.state('brock3').fog[shower.room], 1);
  assert.equal(w.state('brock3').fog[1-shower.room], 0);
  w.toggle('brock3', def.showers[1]); w.toggle('brock3', shower); w.update(5000);
  assert.equal(w.state('brock3').fog[shower.room], 1, 'other running shower keeps steam building');
  w.toggle('brock3', def.showers[1]); w.update(7500);
  assert.equal(w.state('brock3').fog[shower.room], 0.5);
  w.update(7500); assert.equal(w.state('brock3').fog[shower.room], 0);
});

test('host resolves 5 damage each second through block; exit and off stop burns', () => {
  const arena = new RoomCombat();
  const players = {a:{...shower,level:'brock3',char:'titus'}, b:{...shower,level:'brock3',char:'mason'}};
  arena.tick(players, 0);
  arena.command('a', {action:'interact',n:1}, 0);
  arena.command('b', {action:'block',facing:'down',n:1}, 0);
  let snap = arena.tick(players, 999);
  assert.equal(snap.fighters.a.health, 125);
  snap = arena.tick(players, 1000);
  assert.equal(snap.fighters.a.health, 120); assert.equal(snap.fighters.b.health, 85);
  snap = arena.tick(players, 2000); assert.equal(snap.fighters.a.health, 115);
  players.a.y += 32;
  snap = arena.tick(players, 3000); assert.equal(snap.fighters.a.health, 115);
  arena.command('b', {action:'interact',n:2}, 3000);
  snap = arena.tick(players, 4000); assert.equal(snap.fighters.b.health, 75);
  assert.deepEqual(snap.showers.brock3.on, []);
  players.a = {...shower,level:'other',char:'titus'};
  arena.tick(players, 5000); arena.command('a', {action:'interact',n:2}, 5000);
  assert.deepEqual(arena.showers.state('other').on, []);
});

test('dead, stunned, held and distant players cannot toggle; duplicate commands do not retoggle', () => {
  const a = new RoomCombat(), p = {a:{...shower,level:'brock3',char:'titus'}};
  a.tick(p, 0);
  const f = a.fighters.get('a');
  f.rules.health.stunUntil = 1000;
  a.command('a', {action:'interact',n:1}, 0); assert.deepEqual(a.showers.state('brock3').on, []);
  f.rules.health.stunUntil = 0; f.rules.heldBy = {};
  a.command('a', {action:'interact',n:2}, 0); assert.deepEqual(a.showers.state('brock3').on, []);
  f.rules.heldBy = null; f.rules.health.value = 0;
  a.command('a', {action:'interact',n:3}, 0); assert.deepEqual(a.showers.state('brock3').on, []);
  f.rules.health.value = 125;
  a.command('a', {action:'interact',n:4}, 0);
  a.command('a', {action:'interact',n:4}, 1000); assert.deepEqual(a.showers.state('brock3').on, [shower.id]);
  p.a.x = 0; p.a.y = 0; a.sync(p, 1000);
  a.command('a', {action:'interact',n:5}, 1000); assert.deepEqual(a.showers.state('brock3').on, [shower.id]);
});


test('all six bottom showers toggle and burn at the back wall, without reaching beyond it', () => {
  const bottoms = def.showers.filter(s => s.zone.y === 512);
  assert.equal(bottoms.length, 6);
  for (const s of bottoms) {
    const feet = {x:s.x, y:544};
    const w = new ShowerWorld();
    assert.equal(nearestShower(def, feet)?.id, s.id);
    assert.equal(w.toggle('brock3', feet), true);
    assert.equal(w.burning('brock3', feet), true);
    assert.equal(w.burning('brock3', {x:s.x,y:545}), false);
    const arena = new RoomCombat(), players = {a:{...feet,level:'brock3',char:'titus'}};
    arena.tick(players,0); arena.command('a',{action:'interact',n:1},0);
    assert.equal(arena.tick(players,1000).fighters.a.health,120);
    assert.equal(arena.tick(players,2000).fighters.a.health,115);
  }
});
