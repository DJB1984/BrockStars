// Rooms are dark from the hall and hide whoever's inside; from inside a room you see out to the hall.
// Two browsers join one game: one stands in the hall, the other walks into a dorm room and back out.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,
  args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-features=WebRtcHideLocalIpsWithMdns']});
const pages=[], errors=[];
const baseUrl=process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173';
const shots=process.env.SHOTS_DIR ?? 'previews/rooms';
mkdirSync(shots,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const HALL=[712,272], ROOM=[712,120], OTHER_ROOM=[840,120], DOOR=[712,232];   // brock3: hall, a top-row room, its doorway
try {
  for (const character of ['mason','titus']) {
    const context=await browser.newContext({viewport:{width:1280,height:760}});
    const page=await context.newPage();pages.push(page);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${baseUrl}/?solo&character=${character}`);
    await page.waitForFunction(()=>window.pixelforgePlay?.scene?.rooms);
  }
  const [hall,room]=pages;
  const code=await hall.evaluate(async()=>{await brockNet.host({name:'In the hall',level:'brock3'});return brockNet.room;});
  await room.evaluate(async code=>{await brockNet.join({name:'In a room',room:code});},code);
  for(const page of pages)await page.waitForFunction(()=>brockNet.count===2);
  const put=(page,[x,y])=>page.evaluate(([x,y])=>{const p=window.pixelforgePlay.player;p.controller.override={};p.body.reset(x,y);},[x,y]);
  // what this page shows: its own room, how dark each room is, and whether the other player is drawn
  const view=page=>page.evaluate(()=>{
    const s=window.pixelforgePlay.scene, r=s.rooms;
    const other=[...s.remotes.shown.values()][0];
    return { viewer:r.viewer, other:other?.sprite.visible, otherBar:other?.bar.g.visible,
             dark:r.shadows.filter(g=>g.alpha>0.5).length, lit:r.shadows.filter(g=>g.alpha===0).length, rooms:r.shadows.length };
  });
  const settle=()=>wait(500);

  await put(hall,HALL); await put(room,HALL); await settle();
  let h=await view(hall), r=await view(room);
  console.log(`${h.rooms} rooms found`);
  assert.ok(h.rooms>20, 'brock3 has its dorm rooms');
  assert.equal(h.viewer,null); assert.equal(h.dark,h.rooms, 'from the hall every room is dark');
  assert.equal(h.other,true, 'both in the hall: they see each other');
  await hall.screenshot({path:`${shots}/1-hall-both.png`});

  await put(room,ROOM); await settle();
  h=await view(hall); r=await view(room);
  assert.equal(h.other,false, 'the hall player can\'t see into the room'); assert.equal(h.otherBar,false);
  assert.notEqual(r.viewer,null); assert.equal(r.lit,1); assert.equal(r.dark,r.rooms-1, 'inside: only your room is lit');
  assert.equal(r.other,true, 'from the room you see out to the hall');
  await hall.screenshot({path:`${shots}/2-hall-view.png`});
  await room.screenshot({path:`${shots}/3-room-view.png`});

  await put(room,DOOR); await settle();
  assert.equal((await view(hall)).other,false, 'the doorway is part of the room');
  assert.equal((await view(room)).other,true);
  await hall.screenshot({path:`${shots}/4-doorway-from-hall.png`});

  await put(hall,OTHER_ROOM); await put(room,ROOM); await settle();
  h=await view(hall); r=await view(room);
  assert.notEqual(h.viewer,r.viewer);
  assert.equal(h.other,false); assert.equal(r.other,false, 'two different rooms: neither sees the other');

  await put(hall,[ROOM[0]+24,ROOM[1]]); await settle();
  assert.equal((await view(hall)).other,true); assert.equal((await view(room)).other,true, 'same room: they see each other');
  await room.screenshot({path:`${shots}/5-same-room.png`});

  await put(room,HALL); await settle();
  r=await view(room);
  assert.equal(r.viewer,null); assert.equal(r.dark,r.rooms); assert.equal(r.other,false, 'back in the hall, the room is dark again');
  assert.deepEqual(errors,[]);
  console.log('Rooms hide from the hall and see out: ok');
} finally {
  await browser.close();
}
