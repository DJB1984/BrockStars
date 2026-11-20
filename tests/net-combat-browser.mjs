const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,
  args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-features=WebRtcHideLocalIpsWithMdns']});
const contexts=[], pages=[], errors=[];
const { characterStats } = await import('../src/characters.js');
const hostCharacter=process.env.HOST_CHARACTER ?? 'mason';
const hostStats=characterStats(hostCharacter), guestStats=characterStats('titus');
const guestAfterHits=guestStats.health-hostStats.punch-hostStats.headbutt;
const hostAfterHits=hostStats.health-guestStats.headbutt*0.25-guestStats.kick;
const hostAfterTakedown=hostAfterHits-30;
const baseUrl=process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  for (const character of [hostCharacter,'titus']) {
    const context=await browser.newContext({viewport:{width:1280,height:760}});
    contexts.push(context);
    const page=await context.newPage();pages.push(page);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${baseUrl}/?solo&character=${character}`);
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
  await guest.waitForFunction(hp=>window.pixelforgePlay.state().health===hp,guestStats.health-hostStats.punch);
  await input(host,{});
  assert.equal(await health(host),hostStats.health);
  await wait(250);
  const guestId=await guest.evaluate(()=>brockNet.id);
  assert.equal((await snap(host)).fighters[guestId].health,guestStats.health-hostStats.punch);
  await place();
  await input(host,{block:true});await wait(100);
  await input(guest,{headbutt:true});
  await host.waitForFunction(hp=>window.pixelforgePlay.state().health===hp,hostStats.health-guestStats.headbutt*0.25);
  await input(guest,{});await input(host,{});await wait(650);
  await place();
  await input(guest,{kick:true});
  await host.waitForFunction(hp=>window.pixelforgePlay.state().health===hp,hostAfterHits);
  await input(guest,{});await wait(650);
  await place();
  await input(host,{headbutt:true});
  await guest.waitForFunction(hp=>window.pixelforgePlay.state().health===hp,guestAfterHits);
  await input(host,{});
  const effect=await guest.evaluate(()=>window.pixelforgePlay.player.controller.stunnedUntil > window.pixelforgePlay.scene.time.now);
  assert.equal(effect,true);
  await wait(700);
  // Each browser sees the same authoritative values, not duplicate local damage.
  for(const page of pages) {
    const s=await snap(page);
    assert.equal(s.fighters[guestId].health,guestAfterHits);
    assert.deepEqual(errors,[]);
  }
  await place();
  await input(guest,{takedown:true});
  await host.waitForFunction(hp=>window.pixelforgePlay.state().health===hp,hostAfterTakedown);
  const knocked=await host.evaluate(()=>({
    remaining:pixelforgePlay.scene.combat.snapshot().knockdownRemaining,
    animation:pixelforgePlay.player.anims.currentAnim.key,
  }));
  assert.ok(knocked.remaining>1000);assert.ok(knocked.animation.includes('knockdown'));
  assert.equal(knocked.animation,`${hostCharacter}_knockdown_side`);
  assert.equal(await host.evaluate(()=>pixelforgePlay.player.controller.facing),'right');
  await guest.waitForFunction(()=>[...pixelforgePlay.scene.remotes.shown.values()].some(remote=>remote.sprite.anims.currentAnim?.key.includes('knockdown')));
  assert.ok(await guest.evaluate(character=>[...pixelforgePlay.scene.remotes.shown.values()].some(remote=>remote.sprite.anims.currentAnim?.key===`${character}_knockdown_side` && !remote.sprite.flipX),hostCharacter));
  await input(guest,{});await wait(1700);
  assert.equal(await host.evaluate(()=>pixelforgePlay.scene.combat.snapshot().knockdownRemaining),0);
  await place();await input(guest,{takedown:true});await wait(650);
  assert.equal(await health(host),hostAfterTakedown);
  await input(guest,{});
  // Two rooms side by side, 32px apart through the 16px wall between them: in punch and kick range, but
  // walls block hits.
  await host.evaluate(()=>{const p=window.pixelforgePlay.player;p.controller.override={};p.body.reset(632,106);p.controller.facing='right';});
  await guest.evaluate(()=>{const p=window.pixelforgePlay.player;p.controller.override={};p.body.reset(664,106);p.controller.facing='left';});
  await wait(300);
  const beforeWall=await health(guest);
  await input(host,{punch:true});await wait(150);await input(host,{});await wait(500);
  await input(host,{kick:true});await wait(150);await input(host,{});await wait(700);
  assert.equal(await health(guest),beforeWall);
  assert.equal((await snap(host)).fighters[guestId].health,beforeWall);
  console.log('No hits through walls');
  // Put the guest one punch from knockout, then verify the real death/scene restart path.
  await host.evaluate(({id,punch})=>{const h=brockNet.arena.fighters.get(id).rules.health;h.take(h.value-punch);},{id:guestId,punch:hostStats.punch});
  await guest.waitForFunction(hp=>window.pixelforgePlay.state().health===hp,hostStats.punch);
  await place();
  await input(host,{punch:true});
  await guest.waitForFunction(()=>brockNet.combatState.fighters[brockNet.id]?.life===1);
  await input(host,{});
  await guest.waitForFunction(hp=>window.pixelforgePlay?.state().health===hp,guestStats.health);
  assert.equal((await snap(host)).fighters[guestId].life,1);
  assert.equal(await guest.evaluate(()=>window.pixelforgePlay.player.texture.key),'titus');
  await host.screenshot({path:'previews/multiplayer-combat-host.png'});
  await guest.screenshot({path:'previews/multiplayer-combat-guest.png'});
  console.log(JSON.stringify({passed:true,hostHitsGuest:true,guestHitsHost:true,directionalBlock:true,stagger:true,takedown:true,takedownCooldown:true,remoteKnockdown:true,sharedHealth:true,knockoutRespawn:true,errors},null,2));
} finally {
  for(const page of pages)await page.evaluate(()=>window.brockNet?.leave()).catch(()=>{});
  for(const context of contexts)await context.close();
  await browser.close();
}
