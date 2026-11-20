import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const b=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[],base=process.env.TEST_BASE_URL??'http://127.0.0.1:5173';
try {
  for(const char of ['james','mason','titus']) {
    const ctx=await b.newContext({viewport:{width:1280,height:760}}),p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
    await p.goto(base+'/?solo&character='+char);await p.waitForFunction(()=>!!window.pixelforgePlay?.player?.combat);
  }
  const [host,mason,titus]=pages;
  const room=await host.evaluate(async()=>{await brockNet.host({name:'James Bellow',level:'brock3'});return brockNet.room;});
  for(const p of [mason,titus])await p.evaluate(async room=>{await brockNet.join({name:'Bellow partner',room});},room);
  for(const p of pages)await p.waitForFunction(()=>brockNet.count===3);
  for(let i=0;i<pages.length;i++)await pages[i].evaluate(i=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1200+(i===1?70:0),650-(i===2?30:0));p.controller.facing='right';},i);
  await host.waitForTimeout(300);
  await host.evaluate(()=>{pixelforgePlay.player.controller.override=null;});await host.keyboard.down('s');await host.waitForTimeout(100);await host.keyboard.up('s');
  for(const p of [mason,titus])await p.waitForFunction(()=>pixelforgePlay.scene.combat.snapshot().stunRemaining>4000);
  console.log('Three connected fighters received the Bellow result.');
  assert.equal(await host.evaluate(()=>pixelforgePlay.state().health),200);
  assert.equal(await mason.evaluate(()=>pixelforgePlay.state().health),80);assert.equal(await titus.evaluate(()=>pixelforgePlay.state().health),115);
  for(const p of [mason,titus]) {
    assert.ok(await p.evaluate(()=>pixelforgePlay.player.anims.currentAnim.key.includes('stunned')));
    const prevented=await p.evaluate(async()=>{const {heal}=await import('/src/game.js');const before=pixelforgePlay.state().health;heal(10);return pixelforgePlay.state().health===before;});assert.equal(prevented,true);
    await p.evaluate(()=>{pixelforgePlay.player.controller.override={right:true,punch:true,block:true};});
  }
  await host.waitForTimeout(150);await host.screenshot({path:'previews/james-bellow-network.png'});
  await mason.screenshot({path:'previews/james-bellow-victim.png'});
  const frozen=await Promise.all([mason,titus].map(p=>p.evaluate(()=>({x:pixelforgePlay.player.x,y:pixelforgePlay.player.y}))));
  await host.waitForTimeout(2000);
  for(let i=0;i<2;i++)assert.deepEqual(await pages[i+1].evaluate(()=>({x:pixelforgePlay.player.x,y:pixelforgePlay.player.y})),frozen[i]);
  assert.ok(await host.evaluate(()=>[...pixelforgePlay.scene.remotes.shown.values()].every(r=>r.sprite.anims.currentAnim.key.includes('stunned'))));
  assert.ok(await host.evaluate(()=>pixelforgePlay.scene.combat.snapshot().cooldowns.bellow>21000));
  await host.evaluate(()=>{pixelforgePlay.player.controller.override={right:true};});await host.waitForTimeout(100);
  assert.ok(await host.evaluate(()=>pixelforgePlay.player.body.velocity.x>0));
  for(const p of [mason,titus])await p.waitForFunction(()=>pixelforgePlay.scene.combat.snapshot().stunRemaining===0);
  await host.waitForTimeout(100);
  for(const p of [mason,titus])assert.ok(await p.evaluate(()=>pixelforgePlay.player.body.velocity.x>0));
  assert.equal(await mason.evaluate(()=>pixelforgePlay.state().health),80);assert.equal(await titus.evaluate(()=>pixelforgePlay.state().health),115);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,threePlayers:true,allTargets:true,damage:10,stun:5000,healingBlocked:true,recovery:true,remotePoses:true,errors}));
}finally{for(const p of pages)await p.evaluate(()=>brockNet.end('left')).catch(()=>{});await b.close();}
