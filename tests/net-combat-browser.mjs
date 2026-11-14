const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,
  args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-features=WebRtcHideLocalIpsWithMdns']});
const contexts=[], pages=[], errors=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  for (const character of ['mason','titus']) {
    const context=await browser.newContext({viewport:{width:1280,height:760}});
    contexts.push(context);
    const page=await context.newPage();pages.push(page);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:5173/?solo&character=${character}`);
    await page.waitForFunction(()=>window.pixelforgePlay?.player?.combat);
  }
  const [host,guest]=pages;
  const room=await host.evaluate(async()=>{await brockNet.host({name:'Mason host',level:'brock3'});return brockNet.room;});
  console.log('Host room opened');
  await guest.evaluate(async room=>{await brockNet.join({name:'Titus guest',room});},room);
  for(const page of pages)await page.waitForFunction(()=>brockNet.count===2);
  console.log('Two browsers connected');
  const health=page=>page.evaluate(()=>window.pixelforgePlay.state().health);
  const snap=page=>page.evaluate(()=>brockNet.combatState);
  async function place() {
    await host.evaluate(()=>{const p=window.pixelforgePlay.player;p.controller.override={};p.body.reset(1200,650);p.controller.facing='right';});
    await guest.evaluate(()=>{const p=window.pixelforgePlay.player;p.controller.override={};p.body.reset(1220,650);p.controller.facing='left';});
    await wait(200);
  }
  async function input(page, keys) { await page.evaluate(keys=>{window.pixelforgePlay.player.controller.override=keys;},keys); }
  await place();
  await input(host,{punch:true});
  await guest.waitForFunction(()=>window.pixelforgePlay.state().health===96);
  await input(host,{});
  assert.equal(await health(host),100);
  await wait(250);
  const guestId=await guest.evaluate(()=>brockNet.id);
  assert.equal((await snap(host)).fighters[guestId].health,96);
  await place();
  await input(host,{block:true});await wait(100);
  await input(guest,{headbutt:true});
  await host.waitForFunction(()=>window.pixelforgePlay.state().health===97.5);
  await input(guest,{});await input(host,{});await wait(650);
  await place();
  await input(guest,{kick:true});
  await host.waitForFunction(()=>window.pixelforgePlay.state().health===91.5);
  await input(guest,{});await wait(650);
  await place();
  await input(host,{headbutt:true});
  await guest.waitForFunction(()=>window.pixelforgePlay.state().health===86);
  await input(host,{});
  const effect=await guest.evaluate(()=>window.pixelforgePlay.player.controller.stunnedUntil > window.pixelforgePlay.scene.time.now);
  assert.equal(effect,true);
  await wait(700);
  // Each browser sees the same authoritative values, not duplicate local damage.
  for(const page of pages) {
    const s=await snap(page);
    assert.equal(s.fighters[guestId].health,86);
    assert.deepEqual(errors,[]);
  }
  // Put the guest one punch from knockout, then verify the real death/scene restart path.
  await host.evaluate(id=>brockNet.arena.fighters.get(id).rules.health.take(82),guestId);
  await guest.waitForFunction(()=>window.pixelforgePlay.state().health===4);
  await place();
  await input(host,{punch:true});
  await guest.waitForFunction(()=>brockNet.combatState.fighters[brockNet.id]?.life===1);
  await input(host,{});
  await guest.waitForFunction(()=>window.pixelforgePlay?.state().health===100);
  assert.equal((await snap(host)).fighters[guestId].life,1);
  assert.equal(await guest.evaluate(()=>window.pixelforgePlay.player.texture.key),'titus');
  await host.screenshot({path:'previews/multiplayer-combat-host.png'});
  await guest.screenshot({path:'previews/multiplayer-combat-guest.png'});
  console.log(JSON.stringify({passed:true,hostHitsGuest:true,guestHitsHost:true,directionalBlock:true,stagger:true,sharedHealth:true,knockoutRespawn:true,errors},null,2));
} finally {
  for(const page of pages)await page.evaluate(()=>window.brockNet?.leave()).catch(()=>{});
  for(const context of contexts)await context.close();
  await browser.close();
}
