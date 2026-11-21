import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors = [], pages = [];
const put = (p,x,y) => p.evaluate(([x,y]) => { const p=pixelforgePlay.player; p.controller.override={}; p.body.reset(x,y); },[x,y]);
const snapshot = p => p.evaluate(() => {const s=pixelforgePlay.scene;return {health:pixelforgePlay.state().health,on:[...s.showers.state().on],fog:[...s.showers.state().fog],bubble:s.showers.bubble.visible,text:s.showers.bubble.text};});
try {
  for (const character of ['titus','mason']) {
    const ctx = await browser.newContext({viewport:{width:1280,height:760}}), p = await ctx.newPage(); pages.push(p);
    p.on('pageerror',e=>errors.push(e.message));
    await p.goto((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173')+'/?solo&character='+character);
    await p.waitForFunction(()=>window.pixelforgePlay?.scene?.showers);
  }
  const [host,guest] = pages;
  await put(host,1574,374); await host.waitForTimeout(150);
  assert.equal((await snapshot(host)).bubble,true);
  await host.keyboard.press('e');
  await host.waitForTimeout(2200);
  let s=await snapshot(host); assert.equal(s.health,115); assert.deepEqual(s.on,[216]);
  await put(host,1574,412); await host.waitForTimeout(1100); assert.equal((await snapshot(host)).health,115);
  await put(host,1574,374); await host.keyboard.press('e'); await host.waitForTimeout(120);
  assert.deepEqual((await snapshot(host)).on,[]);
  // Walk into every bottom shower until wall collision stops the fighter.
  for (const [id,x] of [[219,1526],[220,1569],[221,1612],[241,924],[242,881],[243,838]]) {
    await put(host,x,480);
    await host.evaluate(()=>{pixelforgePlay.player.controller.override={down:true};});
    await host.waitForTimeout(700);
    assert.equal(await host.evaluate(()=>pixelforgePlay.player.y),544);
    assert.equal((await snapshot(host)).bubble,true);
    const before=(await snapshot(host)).health;
    await host.keyboard.press('e'); await host.waitForTimeout(1150);
    assert.deepEqual((await snapshot(host)).on,[id]);
    assert.equal((await snapshot(host)).health,before-5);
    await host.keyboard.press('e'); await host.waitForTimeout(80);
    assert.deepEqual((await snapshot(host)).on,[]);
  }
  // Two clients share switches and host-authoritative burning.
  const room=await host.evaluate(async()=>{await brockNet.host({name:'Shower host',level:'brock3'});return brockNet.room;});
  await guest.evaluate(async room=>brockNet.join({name:'Shower guest',room}),room);
  await host.waitForFunction(()=>brockNet.count===2);
  await put(host,1574,412); await put(guest,1574,374); await guest.waitForTimeout(300);
  await guest.keyboard.press('e'); await guest.waitForTimeout(2400);
  assert.deepEqual((await snapshot(host)).on,[216]); assert.deepEqual((await snapshot(guest)).on,[216]);
  assert.equal((await snapshot(guest)).health,80); assert.equal((await snapshot(host)).health,125);
  await put(guest,1574,412);
  // Accelerate only the simulation clock to inspect fully built steam without damaging a fighter.
  await host.evaluate(()=>{brockNet.arena.showers.update(20000);});
  await host.waitForTimeout(200);
  assert.equal((await snapshot(guest)).fog[1],1); assert.equal((await snapshot(guest)).fog[0],0);
  await guest.screenshot({path:'previews/showers-fog.png'});
  await put(host,1574,394); await host.waitForTimeout(300); await host.keyboard.press('e');
  await host.waitForTimeout(200); assert.deepEqual((await snapshot(guest)).on,[]);
  await host.evaluate(()=>brockNet.arena.showers.update(15000)); await guest.waitForTimeout(200);
  assert.equal((await snapshot(guest)).fog[1],0);
  await put(guest,1574,394); await guest.waitForTimeout(200);
  await guest.screenshot({path:'previews/showers-clear.png'});
  await put(guest,1526,480);
  await guest.evaluate(()=>{pixelforgePlay.player.controller.override={down:true};});
  await guest.waitForTimeout(800);
  assert.equal(await guest.evaluate(()=>pixelforgePlay.player.y),544);
  const beforeBottom=(await snapshot(guest)).health;
  await guest.keyboard.press('e'); await guest.waitForTimeout(1250);
  assert.deepEqual((await snapshot(host)).on,[219]);
  assert.equal((await snapshot(guest)).health,beforeBottom-5);
  await guest.keyboard.press('e'); await guest.waitForTimeout(200);
  assert.deepEqual((await snapshot(host)).on,[]);
  await guest.screenshot({path:'previews/showers-bottom-fixed.png'});
  await put(guest,1200,650); await guest.waitForTimeout(100); assert.equal((await snapshot(guest)).bubble,false);
  assert.deepEqual(errors,[]);
  console.log('Solo and multiplayer showers: prompt, nearest toggle, 5 HP/s, exit, fog, and clearing passed');
} finally { await browser.close(); }
