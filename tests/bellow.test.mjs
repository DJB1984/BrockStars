import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, CombatRules, HealthPool, attackTargets } from '../src/combat/rules.js';
import { RoomCombat } from '../src/net/combat.js';

test('Bellow covers a 10-tile circle in every direction, ignoring facing and old movement paths',()=>{
  const inside=[{x:160,y:0},{x:-160,y:0},{x:0,y:160},{x:0,y:-160},{x:112,y:112}];
  const outside=[{x:160.01,y:0},{x:114,y:114},{x:180,y:0}];
  for(const facing of ['up','down','left','right']) {
    assert.equal(attackTargets({x:0,y:0},inside,facing,ATTACKS.bellow).length,5);
    assert.deepEqual(attackTargets({x:0,y:0},outside,facing,ATTACKS.bellow,[{x:180,y:0}]),[]);
  }
});

test('Bellow is James-only, needs a new press, and preserves its 25s cooldown across scenes and fighters',()=>{
  for(const char of ['mason','titus']) {const r=new CombatRules(undefined,char);r.update(0,{bellow:true},'right');assert.equal(r.attack,null);}
  const health=new HealthPool(),r=new CombatRules(health,'james');
  r.update(0,{bellow:true},'left');assert.equal(r.attack.name,'bellow');r.finishAttack();
  const next=new CombatRules(health,'mason');next.setCharacter('james');
  next.update(24999,{bellow:true},'down');assert.equal(next.attack,null);
  next.update(25000,{bellow:true},'down');assert.equal(next.attack,null);
  next.update(25001,{},'down');next.update(25002,{bellow:true},'down');assert.equal(next.attack.name,'bellow');
});

test('Bellow always does 10 damage and stuns for 5s through every block; scene changes cannot remove it',()=>{
  for(const facing of ['up','down','left','right']) {
    const r=new CombatRules();r.update(0,{block:true},facing);
    const hit=r.receive(ATTACKS.bellow,facing,350);
    assert.equal(hit.damage,10);assert.equal(hit.blocked,false);assert.equal(hit.stun,5000);assert.equal(hit.knockback,0);
    assert.equal(r.block,null);assert.equal(r.stunUntil,5350);
    const next=new CombatRules(r.health,'mason');next.update(5349,{punch:true,block:true},'right');
    assert.equal(next.attack,null);assert.equal(next.block,null);
    next.update(5350,{},'right');next.update(5351,{punch:true},'right');assert.equal(next.attack.name,'punch');
  }
});

test('stun prevents direct healing and regeneration for exactly 5s, including a timestep crossing its end',()=>{
  const r=new CombatRules();r.receive(ATTACKS.bellow,'right',0);const h=r.health;
  h.quiet=45000;assert.equal(h.heal(10),0);assert.equal(h.value,115);
  h.update(4999);assert.equal(h.value,115);assert.equal(h.heal(10),0);
  h.update(1001);assert.equal(h.value,117);assert.equal(h.healingBlockedFor,0);
  assert.equal(h.heal(3),3);assert.equal(h.value,120);
  h.reset();assert.equal(h.healingBlockedFor,0);assert.equal(h.stunUntil,0);
});

const command=(r,id,action,n,now,facing='right')=>r.command(id,{action,n,facing},now);
function arena() {
  const r=new RoomCombat(),p={
    a:{char:'james',x:300,y:300,level:'brock3'},
    b:{char:'titus',x:460,y:300,level:'brock3'},
    c:{char:'mason',x:300,y:140,level:'brock3'},
    d:{char:'james',x:188,y:188,level:'brock3'},
    far:{char:'titus',x:461,y:300,level:'brock3'},
    corner:{char:'titus',x:414,y:414,level:'brock3'},
    other:{char:'titus',x:300,y:300,level:'other'},
  };r.tick(p,0);return {r,p};
}

test('host Bellow hits every opponent in range once, bypasses a front block, and leaves the caster and other levels safe',()=>{
  const {r,p}=arena();command(r,'b','block',1,0,'left');command(r,'a','bellow',1,0);
  assert.equal(r.tick(p,349).hits.length,0);const s=r.tick(p,360);
  assert.equal(s.fighters.a.health,200);assert.equal(s.fighters.b.health,115);assert.equal(s.fighters.c.health,80);assert.equal(s.fighters.d.health,190);
  for(const id of ['b','c','d']) {assert.equal(s.fighters[id].stun,5000);assert.equal(s.fighters[id].healingBlockedFor,5000);}
  for(const id of ['far','corner','other']){assert.equal(s.fighters[id].health,125);assert.equal(s.fighters[id].stun,0);}
  assert.equal(s.hits.length,3);assert.equal(r.tick(p,400).hits.length,0);assert.equal(r.tick(p,900).hits.length,0);
  assert.equal(r.tick(p,1000).fighters.a.bellowCooldown,24000);
});

test('host rejects stunned movement/actions and healing, preserves stun through fighter/scene switches, and recovers at 5s',()=>{
  const {r,p}=arena();command(r,'a','bellow',1,0);r.tick(p,360);
  p.b.x=900;p.b.y=900;let s=r.tick(p,1000);assert.deepEqual(s.fighters.b.stunPosition,{x:460,y:300});
  command(r,'b','punch',1,1001);assert.equal(r.fighters.get('b').action,null);
  r.fighters.get('b').rules.health.quiet=45000;assert.equal(r.fighters.get('b').rules.health.heal(20),0);
  p.b.char='mason';p.b.level='other';r.tick(p,2000);assert.equal(r.fighters.get('b').rules.stunUntil,5360);
  p.b.x=1100;p.b.y=1100;
  s=r.tick(p,5359);assert.deepEqual(s.fighters.b.stunPosition,{x:900,y:900});assert.equal(s.fighters.b.stun,1);assert.equal(s.fighters.b.healingBlockedFor,1);
  assert.equal(r.fighters.get('b').rules.health.heal(20),0);
  s=r.tick(p,5360);assert.equal(s.fighters.b.stun,0);assert.equal(s.fighters.b.stunPosition,null);
  command(r,'b','punch',2,5361);assert.equal(r.fighters.get('b').action.name,'punch');
});

test('host misses still consume the Bellow cooldown; other characters cannot issue Bellow commands',()=>{
  const {r,p}=arena();command(r,'b','bellow',1,0);assert.equal(r.fighters.get('b').action,null);
  for(const id of ['b','c','d']){p[id].x=1000;p[id].y=1000;}
  command(r,'a','bellow',1,0);assert.equal(r.tick(p,360).hits.length,0);r.tick(p,1000);
  command(r,'a','bellow',2,1001);assert.equal(r.fighters.get('a').action,null);
  command(r,'a','bellow',3,25000);assert.equal(r.fighters.get('a').action.name,'bellow');
});
