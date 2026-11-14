import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCombat } from '../src/net/combat.js';

const positions = () => ({a:{x:100,y:100,level:'brock3'}, b:{x:120,y:100,level:'brock3'}});
function setup() { const room=new RoomCombat(), p=positions(); room.tick(p,0); return {room,p}; }
const cmd=(room,id,action,facing,n,time)=>room.command(id,{action,facing,n},time);

test('host resolves a short active frame between ticks once; duplicate commands cannot double-hit',()=>{
  const {room,p}=setup();
  cmd(room,'a','punch','right',1,0);
  room.tick(p,99);
  const first=room.tick(p,165);
  assert.equal(first.fighters.b.health,96); assert.equal(first.hits.length,1);
  cmd(room,'a','punch','right',1,170);
  assert.equal(room.tick(p,190).hits.length,0);
  assert.equal(room.tick(p,500).fighters.b.health,96);
});

test('range, facing, and level isolate hits',()=>{
  for(const [x,y,level] of [[129,100,'brock3'],[90,100,'brock3'],[120,120,'brock3'],[120,100,'elsewhere']]) {
    const {room,p}=setup(); Object.assign(p.b,{x,y,level}); room.tick(p,1);
    cmd(room,'a','punch','right',1,1);
    assert.equal(room.tick(p,120).fighters.b.health,100);
  }
});

test('directional block reduces damage and release restores full damage',()=>{
  const {room,p}=setup();
  cmd(room,'b','block','left',1,0);cmd(room,'a','punch','right',1,0);
  assert.equal(room.tick(p,120).fighters.b.health,99);
  cmd(room,'b','release',undefined,2,401);cmd(room,'a','punch','right',2,401);
  assert.equal(room.tick(p,520).fighters.b.health,95);
});

test('host enforces cooldowns, block timeout, and stagger interruption',()=>{
  const {room,p}=setup();
  cmd(room,'a','headbutt','right',1,0);
  cmd(room,'b','headbutt','left',1,100);
  const s=room.tick(p,240);assert.equal(s.fighters.b.health,90);assert.equal(s.fighters.b.attack,null);
  cmd(room,'b','punch','left',2,241);assert.equal(room.fighters.get('b').action,null);
  room.tick(p,701);cmd(room,'a','headbutt','right',2,701);assert.equal(room.fighters.get('a').action,null);
  cmd(room,'b','block','left',3,1600);assert.equal(room.tick(p,4601).fighters.b.block,null);
});

test('health regenerates on host and knockout respawns exactly once',()=>{
  const {room,p}=setup();
  for(let i=0;i<10;i++) {
    const now=i*1600;
    cmd(room,'a','headbutt','right',i+1,now);
    room.tick(p,now+240);room.tick(p,now+700);
  }
  const s=room.tick(p,15200);assert.equal(s.fighters.b.life,1);assert.equal(s.fighters.b.health,100);
  assert.equal(room.tick(p,16000).fighters.b.life,1);
  cmd(room,'a','punch','right',11,16001);room.tick(p,16120);
  assert.equal(room.tick(p,61120).fighters.b.health,96);
  assert.equal(room.tick(p,62120).fighters.b.health,98);
  delete p.b;assert.equal(room.tick(p,63000).fighters.b,undefined);
});

test('a connected player becoming temporarily quiet cannot reset their health',()=>{
  const {room,p}=setup();cmd(room,'a','punch','right',1,0);room.tick(p,120);
  const quiet={a:p.a};
  room.tick(quiet,5000,['a','b']);
  assert.equal(room.fighters.get('b').rules.health.value,96);
  assert.equal(room.tick(p,5001,['a','b']).fighters.b.health,96);
  room.tick(quiet,5002,['a']);assert.equal(room.fighters.has('b'),false);
});
