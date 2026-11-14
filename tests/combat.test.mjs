import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatRules, HealthPool, ATTACKS, directionTo } from '../src/combat/rules.js';

test('attacks require a fresh press after the animation ends and respect their own cooldown', () => {
  const c=new CombatRules();
  c.update(0,{punch:true},'right');
  c.update(100,{kick:true,headbutt:true},'left');
  assert.equal(c.attack.name,'punch');
  assert.equal(c.attack.facing,'right');
  c.finishAttack();
  c.update(400,{kick:true},'right');
  assert.equal(c.attack,null); // a held/queued key cannot trigger
  c.update(401,{},'right'); c.update(402,{kick:true},'right');
  assert.equal(c.attack.name,'kick');
  c.finishAttack(); c.update(1000,{},'right'); c.update(1001,{kick:true},'right');
  assert.equal(c.attack,null);
  c.update(1202,{},'right'); c.update(1203,{kick:true},'right');
  assert.equal(c.attack.name,'kick');
});
test('block direction stays fixed, expires at 3s and needs release plus cooldown', () => {
  const c=new CombatRules(); c.update(0,{block:true},'up');
  c.update(2000,{block:true},'left'); assert.equal(c.block.facing,'up');
  c.update(3000,{block:true},'right'); assert.equal(c.block,null);
  c.update(5000,{block:true},'right'); assert.equal(c.block,null);
  c.update(5001,{},'right'); c.update(5002,{block:true},'right'); assert.equal(c.block.facing,'right');
  c.update(5100,{},'right'); c.update(5101,{block:true},'right'); assert.equal(c.block,null);
});
test('only the guarded cardinal side reduces damage; headbutt staggers an unguarded defender', () => {
  for (const facing of ['up','down','left','right']) for (const incoming of ['up','down','left','right']) {
    const c=new CombatRules(); c.update(0,{block:true},facing);
    const r=c.receive(ATTACKS.headbutt,incoming,100);
    assert.equal(r.damage,facing===incoming?2.5:10);
    assert.equal(r.stagger,facing===incoming?0:350);
  }
  assert.equal(directionTo(-2,10),'down');
  assert.equal(directionTo(10,-2),'right');
});
test('regen waits 45 seconds, heals 2 HP/s, restarts after damage and caps at 100', () => {
  const h=new HealthPool(); h.take(20); h.update(44999); assert.equal(h.value,80);
  h.update(1); assert.equal(h.value,80); h.update(5000); assert.equal(h.value,90);
  h.take(1); h.update(45000); assert.equal(h.value,89); h.update(6000); assert.equal(h.value,100);
  h.take(100); h.update(60000); assert.equal(h.value,0);
});
