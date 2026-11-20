import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCombat } from '../src/net/combat.js';

const positions = () => ({a:{x:100,y:100,level:'brock3'}, b:{x:120,y:100,level:'brock3'}});
function setup() { const room=new RoomCombat(), p=positions(); room.tick(p,0); return {room,p}; }
const cmd=(room,id,action,facing,n,time)=>room.command(id,{action,facing,n},time);

test('host resolves a short active frame between ticks once; duplicate commands cannot double-hit',()=>{
  const {room,p}=setup();
  cmd(room,'a','punch','right',1,0);
  room.tick(p,60);
  const first=room.tick(p,180);
  assert.equal(first.fighters.b.health,121); assert.equal(first.hits.length,1);
  cmd(room,'a','punch','right',1,170);
  assert.equal(room.tick(p,190).hits.length,0);
  assert.equal(room.tick(p,500).fighters.b.health,121);
});

test('range, facing, and level isolate hits',()=>{
  // Zones credit the defender's body (BODY=9): punch covers forward -9..43, across 29.
  for(const [x,y,level] of [[144,100,'brock3'],[90,100,'brock3'],[120,131,'brock3'],[120,100,'elsewhere']]) {
    const {room,p}=setup(); Object.assign(p.b,{x,y,level}); room.tick(p,1);
    cmd(room,'a','punch','right',1,1);
    assert.equal(room.tick(p,120).fighters.b.health,125);
  }
});

test('directional block reduces damage and release restores full damage',()=>{
  const {room,p}=setup();
  cmd(room,'b','block','left',1,0);cmd(room,'a','punch','right',1,0);
  assert.equal(room.tick(p,120).fighters.b.health,124);
  cmd(room,'b','release',undefined,2,401);cmd(room,'a','punch','right',2,401);
  assert.equal(room.tick(p,520).fighters.b.health,120);
});

test('host enforces cooldowns, block timeout, and stagger interruption',()=>{
  const {room,p}=setup();
  cmd(room,'a','headbutt','right',1,0);
  cmd(room,'b','headbutt','left',1,100);
  const s=room.tick(p,240);assert.equal(s.fighters.b.health,115);assert.equal(s.fighters.b.attack,null);
  cmd(room,'b','punch','left',2,241);assert.equal(room.fighters.get('b').action,null);
  room.tick(p,701);cmd(room,'a','headbutt','right',2,701);assert.equal(room.fighters.get('a').action,null);
  cmd(room,'b','block','left',3,1600);assert.equal(room.tick(p,4601).fighters.b.block,null);
});

test('health regenerates on host and knockout respawns exactly once',()=>{
  const {room,p}=setup();
  room.damage('b','a',{damage:125,knockback:0,stagger:0},null,0);
  assert.equal(room.tick(p,399).fighters.b.health,0);
  const respawn=room.tick(p,400).fighters.b;
  assert.equal(respawn.life,1);assert.equal(respawn.health,125);
  assert.equal(room.tick(p,500).fighters.b.life,1);
  cmd(room,'a','punch','right',1,501);room.tick(p,620);
  assert.equal(room.tick(p,45620).fighters.b.health,121);
  assert.equal(room.tick(p,46620).fighters.b.health,123);
  delete p.b;assert.equal(room.tick(p,47000).fighters.b,undefined);
});

test('a connected player becoming temporarily quiet cannot reset their health',()=>{
  const {room,p}=setup();cmd(room,'a','punch','right',1,0);room.tick(p,120);
  const quiet={a:p.a};
  room.tick(quiet,5000,['a','b']);
  assert.equal(room.fighters.get('b').rules.health.value,121);
  assert.equal(room.tick(p,5001,['a','b']).fighters.b.health,121);
  room.tick(quiet,5002,['a']);assert.equal(room.fighters.has('b'),false);
});

test('Takedown has a 500ms wind-up, narrow reach, and hits only the nearest opponent once',()=>{
  const {room,p}=setup(); p.c={x:123,y:100,level:'brock3'};
  room.tick(p,0); cmd(room,'a','takedown','right',1,0);
  assert.equal(room.tick(p,499).fighters.b.health,125);
  const hit=room.tick(p,510);
  assert.equal(hit.fighters.b.health,100); assert.equal(hit.fighters.b.knockdown,1500);
  assert.equal(hit.fighters.b.knockdownFacing,'left');
  assert.equal(hit.hits[0].knockdownFacing,'left');
  assert.equal(hit.fighters.c.health,125); assert.equal(hit.hits.length,1);
  p.b.x=200;
  assert.equal(room.tick(p,550).fighters.c.health,125);
  for(const [x,y] of [[134,100],[120,120],[90,100]]) {
    const {room:r,p:pos}=setup(); Object.assign(pos.b,{x,y});r.tick(pos,0);
    cmd(r,'a','takedown','right',1,0); assert.equal(r.tick(pos,520).fighters.b.health,125);
  }
});

test('host blocks Takedown, consumes its cooldown on misses, and rejects Mason using it',()=>{
  const {room,p}=setup(); cmd(room,'b','block','left',1,0);cmd(room,'a','takedown','right',1,0);
  const hit=room.tick(p,520); assert.equal(hit.fighters.b.health,118.75); assert.equal(hit.fighters.b.knockdown,0);
  room.tick(p,1100);cmd(room,'a','takedown','right',2,1101);assert.equal(room.fighters.get('a').action,null);
  p.b.x=200;room.tick(p,20000);cmd(room,'a','takedown','right',3,20000);room.tick(p,21100);
  cmd(room,'a','takedown','right',4,22000);assert.equal(room.fighters.get('a').action,null);
  p.a.char='mason';room.tick(p,40000);cmd(room,'a','takedown','right',5,40000);
  assert.equal(room.fighters.get('a').action,null);
});

test('host uses attacker stats and defender health for each playable fighter',()=>{
  for (const [char,hp,punch,kick,headbutt] of [['mason',90,3,7,9],['titus',125,4,9,10],['james',200,5,8,15]]) {
    for (const [name,damage,active] of [['punch',punch,120],['kick',kick,200],['headbutt',headbutt,240]]) {
      const room=new RoomCombat(), p={a:{x:100,y:100,level:'brock3',char},b:{x:120,y:100,level:'brock3',char}};
      room.tick(p,0);cmd(room,'a',name,'right',1,0);
      const result=room.tick(p,active);
      assert.equal(result.fighters.a.health,hp);assert.equal(result.fighters.b.maxHealth,hp);
      assert.equal(result.fighters.b.health,hp-damage);
    }
  }
});

test('host switching characters and respawning retain the correct health ceiling',()=>{
  const room=new RoomCombat(),p={a:{x:100,y:100,level:'brock3',char:'james'}};
  room.tick(p,0);room.damage('a',null,{damage:100,knockback:0,stagger:0},null,0);
  p.a.char='mason';assert.equal(room.tick(p,1).fighters.a.health,45);
  room.damage('a',null,{damage:45,knockback:0,stagger:0},null,2);
  assert.equal(room.tick(p,402).fighters.a.health,90);
  p.a.level='other';assert.equal(room.tick(p,403).fighters.a.health,90);
});
