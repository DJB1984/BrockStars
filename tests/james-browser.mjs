// James in the current React fighter selector, solo play, and as a multiplayer guest.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base=process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,
  args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:760}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?solo&character=james');
  await page.waitForFunction(()=>window.pixelforgePlay?.player.combat);
  assert.deepEqual(await page.evaluate(()=>({speed:pixelforgePlay.player.controller.opts.speed,
    health:pixelforgePlay.state().health,max:pixelforgePlay.scene.combat.rules.health.max})),{speed:126,health:200,max:200});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Change fighter'}).click();
  await page.getByRole('button',{name:'James',exact:true}).click();
  const card=page.getByRole('complementary',{name:'James’s stats'});
  assert.match(await card.innerText(),/200/);
  assert.match(await card.innerText(),/126/);
  assert.match(await card.innerText(),/15/);
  await page.getByRole('button',{name:'Fight!'}).click();
  await page.waitForFunction(()=>window.pixelforgePlay?.player.texture.key==='james' && !document.querySelector('.bs'));
  const rig=await page.evaluate(async()=>{
    const {ATTACKS}=await import('/src/combat/rules.js');
    const data=await (await fetch('/james.json')).json();
    for(const name of ['punch','kick','headbutt'])for(const dir of ['down','up','side']){
      const tag=data.meta.frameTags.find(t=>t.name==='james_'+name+'_'+dir);
      const durations=[];for(let i=tag.from;i<=tag.to;i++)durations.push(data.frames[i].duration);
      if(JSON.stringify(durations)!==JSON.stringify(ATTACKS[name].frames))throw Error(name+' animation timing');
    }
    const play=pixelforgePlay,s=play.scene;play.freeze();
    s.level.player.body.reset(1200,650);
    const st=play.step(100,{right:true});
    const speed=Math.hypot(st.vx,st.vy);
    const spec=s.combat.rules.attackSpec('punch');
    play.step(17,{});play.step(17,{takedown:true});
    const special=s.combat.rules.attack;
    play.release();return {speed,damage:spec.damage,special};
  });
  assert.equal(rig.speed,126);assert.equal(rig.damage,5);assert.equal(rig.special,null);
  const host=await browser.newPage({viewport:{width:1280,height:760}});
  host.on('pageerror',e=>errors.push(e.message));
  await host.goto(base+'/?solo&character=titus');
  await host.waitForFunction(()=>window.pixelforgePlay?.player.combat);
  try {
    const room=await host.evaluate(async()=>{await brockNet.host({name:'Titus host',level:'brock3'});return brockNet.room;});
    await page.evaluate(async room=>{await brockNet.join({name:'James guest',room});},room);
    await host.waitForFunction(()=>brockNet.count===2 && Object.values(brockNet.players).some(p=>p.char==='james'));
    await host.evaluate(()=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1200,650);});
    await page.evaluate(()=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1220,650);p.controller.facing='left';});
    await page.waitForTimeout(250);
    await page.evaluate(()=>{pixelforgePlay.player.controller.override={punch:true};});
    await host.waitForFunction(()=>pixelforgePlay.state().health===120);
    await host.waitForFunction(()=>[...pixelforgePlay.scene.remotes.shown.values()].some(r=>r.sprite.texture.key==='james'));
    assert.equal(await page.evaluate(()=>pixelforgePlay.state().health),200);
  } finally {
    await page.evaluate(()=>window.brockNet?.leave());await host.evaluate(()=>window.brockNet?.leave());
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'previews/james-merged-game.png'});
  console.log(JSON.stringify({passed:true,selector:true,health:200,speed:126,animationTiming:true,guestMultiplayer:true,errors}));
} finally {await browser.close();}
