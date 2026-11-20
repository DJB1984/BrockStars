import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[];const base=process.env.TEST_BASE_URL??'http://127.0.0.1:5173';
try {
  for(const character of ['mason','titus']){
    const context=await browser.newContext({viewport:{width:1280,height:760}}),page=await context.newPage();pages.push(page);
    page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?solo&character='+character);
    await page.waitForFunction(()=>!!window.pixelforgePlay?.player?.combat);
  }
  const [host,guest]=pages;
  const room=await host.evaluate(async()=>{await brockNet.host({name:'Grapple test',level:'brock3'});return brockNet.room;});
  await guest.evaluate(async room=>{await brockNet.join({name:'Headlock partner',room});},room);
  for(const p of pages)await p.waitForFunction(()=>brockNet.count===2);
  await host.evaluate(()=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1200,650);p.controller.facing='down';});
  await guest.evaluate(()=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1200,670);p.controller.facing='up';});
  await host.waitForTimeout(300);
  await host.evaluate(()=>{pixelforgePlay.player.controller.override={grapple:true};});
  await guest.waitForFunction(()=>!!pixelforgePlay.scene.combat.networkHeld);
  assert.equal(await guest.evaluate(()=>pixelforgePlay.state().health),125);
  await guest.evaluate(()=>{pixelforgePlay.player.controller.override={right:true,punch:true,block:true};});
  await host.evaluate(()=>{pixelforgePlay.player.controller.override={left:true};});
  await host.waitForTimeout(700);
  assert.equal(await guest.evaluate(()=>pixelforgePlay.state().health),125);
  assert.equal(await guest.evaluate(()=>pixelforgePlay.player.anims.currentAnim.key),'titus_grappled_down');
  assert.equal(await guest.evaluate(()=>pixelforgePlay.player.body.velocity.length()),0);
  assert.equal(await host.evaluate(()=>pixelforgePlay.player.body.velocity.length()),0);
  assert.ok(await host.evaluate(()=>[...pixelforgePlay.scene.remotes.shown.values()].some(r=>r.sprite.anims.currentAnim?.key==='titus_grappled_down')));
  assert.ok(await guest.evaluate(()=>[...pixelforgePlay.scene.remotes.shown.values()].some(r=>r.sprite.anims.currentAnim?.key==='mason_grapple_down')));
  await host.screenshot({path:'previews/mason-grapple-network-host.png'});await guest.screenshot({path:'previews/mason-grapple-network-guest.png'});
  await guest.waitForFunction(()=>pixelforgePlay.state().health===100);
  assert.equal(await guest.evaluate(()=>!!pixelforgePlay.scene.combat.networkHeld),false);
  await guest.evaluate(()=>{pixelforgePlay.player.controller.override={};});await host.waitForTimeout(500);
  assert.equal(await guest.evaluate(()=>pixelforgePlay.state().health),100);
  assert.ok(await host.evaluate(()=>pixelforgePlay.scene.combat.snapshot().cooldowns.grapple>15000));
  // A lost host must also release the local client when no further snapshots can arrive.
  await host.evaluate(()=>{
    const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1200,650);p.controller.facing='down';
    brockNet.arena.fighters.get(brockNet.id).rules.readyAt.grapple=0;pixelforgePlay.scene.combat.rules.readyAt.grapple=0;
  });
  await guest.evaluate(()=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1200,670);});
  await host.waitForTimeout(250);await host.evaluate(()=>{pixelforgePlay.player.controller.override={grapple:true};});
  await guest.waitForFunction(()=>!!pixelforgePlay.scene.combat.networkHeld);
  await host.evaluate(()=>brockNet.end('left'));
  await guest.waitForFunction(()=>!brockNet.active&&!pixelforgePlay.scene.combat.rules.heldBy);
  await guest.evaluate(()=>{pixelforgePlay.player.controller.override={right:true};});await guest.waitForTimeout(100);
  assert.ok(await guest.evaluate(()=>pixelforgePlay.player.body.velocity.x>0));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,networkHeadlock:true,remotePoses:true,rooted:true,delayed25Damage:true,cooldown:true,hostDisconnectReleases:true,errors}));
}finally{for(const p of pages)await p.evaluate(()=>brockNet.end('left')).catch(()=>{});await browser.close();}
