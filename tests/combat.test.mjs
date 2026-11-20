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
  c.finishAttack(); c.update(900,{},'right'); c.update(901,{kick:true},'right');
  assert.equal(c.attack,null);
  c.update(5402,{},'right'); c.update(5403,{kick:true},'right');
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

test('Takedown is Titus-only, requires a fresh press, and consumes 20s cooldown on a miss across scene changes', () => {
  const health=new HealthPool(), c=new CombatRules(health);
  c.update(100,{takedown:true},'left');
  assert.deepEqual(c.attack,{name:'takedown',facing:'left',start:100});
  c.finishAttack();
  const next=new CombatRules(health);
  next.update(1200,{takedown:true},'right'); assert.equal(next.attack,null);
  next.update(20100,{takedown:true},'right'); assert.equal(next.attack,null);
  next.update(20101,{},'right'); next.update(20102,{takedown:true},'right');
  assert.equal(next.attack.name,'takedown');
  const mason=new CombatRules(new HealthPool(),'mason');
  mason.update(0,{takedown:true},'down'); assert.equal(mason.attack,null);
});

test('Takedown knocks down for 1.5s and interrupts attacks; a front block prevents the knockdown', () => {
  const c=new CombatRules(); c.update(0,{kick:true},'right');
  const hit=c.receive(ATTACKS.takedown,'left',500);
  assert.equal(hit.damage,30); assert.equal(hit.knockdown,1500); assert.equal(c.attack,null);
  c.update(1999,{punch:true},'right'); assert.equal(c.attack,null);
  c.update(2000,{},'right'); c.update(2001,{punch:true},'right'); assert.equal(c.attack.name,'punch');
  for(const facing of ['left','right','up','down']) {
    const defender=new CombatRules(); defender.update(0,{block:true},facing);
    const blocked=defender.receive(ATTACKS.takedown,facing,500);
    assert.equal(blocked.damage,7.5); assert.equal(blocked.knockdown,0); assert.equal(blocked.stagger,0);
    assert.ok(defender.block);
  }
});

test('every balance profile supplies health, damage, speed, and basic cooldowns', async () => {
  const { CHARACTER_STATS, CHARACTERS } = await import('../src/characters.js');
  const expected = {
    mason: [90,3,7,9,1.1], titus: [125,4,9,10,1], james: [200,5,8,15,0.9],
    ben: [185,6,7,12,0.8], clayton: [115,5,7,9,1], anand: [135,3,6,9,1],
    tj: [100,2,4,7,1.15], bigred: [150,5,8,14,0.95],
  };
  for (const [id, [hp,p,k,h,speed]] of Object.entries(expected)) {
    const r = new CombatRules(undefined,id), stats=CHARACTER_STATS[id];
    assert.equal(r.health.value,hp);assert.equal(r.health.max,hp);
    assert.equal(stats.speed,Math.round(140*speed));
    for (const [name,damage,cooldown] of [['punch',p,300],['kick',k,5000],['headbutt',h,10000]]) {
      assert.equal(r.attackSpec(name).damage,damage);
      r.update(0,{[name]:true},'right');r.finishAttack();r.update(1,{},'right');
      r.update(cooldown-1,{[name]:true},'right');assert.equal(r.attack,null);
      r.update(cooldown,{},'right');r.update(cooldown+1,{[name]:true},'right');
      assert.equal(r.attack.name,name);r.finishAttack();r.previous={};
    }
    r.update(20000,{block:true},'right');assert.equal(r.block.until,23000);
  }
  assert.deepEqual(Object.keys(CHARACTERS),['titus','mason','james']);
});

test('character switches preserve health percentage, knockout, regen delay, and cooldowns',()=>{
  const health=new HealthPool(), r=new CombatRules(health,'mason');
  health.take(45);r.update(0,{kick:true},'right');
  r.setCharacter('james');assert.equal(health.value,100);assert.equal(health.max,200);
  assert.equal(r.readyAt.kick,5000);assert.equal(health.quiet,0);
  const next=new CombatRules(health,'james');assert.equal(next.health.value,100);
  health.update(45000);health.update(100000);assert.equal(health.value,200);
  health.take(200);r.setCharacter('titus');assert.equal(health.value,0);
  health.reset();assert.equal(health.value,125);
});


test('Grapple is Mason-only, consumes a 20s cooldown on misses, and survives scene/fighter changes', () => {
  for (const character of ['titus','james']) {
    const r=new CombatRules(undefined,character);r.update(0,{grapple:true},'right');assert.equal(r.attack,null);
  }
  const health=new HealthPool(),r=new CombatRules(health,'mason');
  r.update(100,{grapple:true},'right');assert.equal(r.attack.name,'grapple');r.finishAttack();
  const next=new CombatRules(health,'titus');next.setCharacter('mason');
  next.update(20099,{grapple:true},'right');assert.equal(next.attack,null);
  next.update(20100,{grapple:true},'right');assert.equal(next.attack,null,'held input never repeats');
  next.update(20101,{},'right');next.update(20102,{grapple:true},'right');assert.equal(next.attack.name,'grapple');
});
