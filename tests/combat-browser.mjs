// Run against npm run dev. Uses installed Playwright, or PLAYWRIGHT_MODULE from a bundled runtime.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const character = process.env.CHARACTER ?? 'titus';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1280,height:760}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:5173/?practice=1&character=${character}`);
  await page.waitForFunction(()=>window.pixelforgePlay?.state().level==='combat-practice');
  assert.equal(await page.evaluate(()=>window.pixelforgePlay.player.texture.key),character);
  const results=await page.evaluate(async()=>{
    const out=[];
    const play=window.pixelforgePlay; play.freeze();
    const scene=play.scene;
    const {ATTACKS}=await import('/src/combat/rules.js');
    window.setupFight=(direction='right',distance=20)=>{
      const offset={right:[distance,0],left:[-distance,0],up:[0,-distance],down:[0,distance]}[direction];
      scene.health.reset();scene.partnerHealth.reset();
      scene.player.body.reset(300,220); scene.partner.body.reset(300+offset[0],220+offset[1]);
      scene.player.controller.facing=direction;
      for(const c of [scene.combat,scene.partnerCombat]) {
        c.rules.attack=null;c.rules.block=null;c.rules.readyAt={};c.rules.previous={};c.rules.blockReadyAt=0;c.rules.staggerUntil=0;c.controller.stunnedUntil=0;c.controller.busy=null;
      }
      play.step(17,{});
    };
    for(const direction of ['right','left','up','down']) for(const name of ['punch','kick','headbutt']) {
      setupFight(direction,name==='kick'?28:20);
      play.step(1000,{[name]:true});
      out.push({direction,name,health:scene.partnerHealth.value,expected:100-ATTACKS[name].damage,player:play.state(),targetX:scene.partner.x,targetY:scene.partner.y});
    }
    return out;
  });
  assert.deepEqual(errors,[]);
  for(const r of results) assert.equal(r.health,r.expected,`${r.name} ${r.direction}`);
  const checks=await page.evaluate(async()=>{
    const play=window.pixelforgePlay, s=play.scene;
    const { ATTACKS }=await import('/src/combat/rules.js');
    const checks=[];
    const check=(label,ok,detail)=>{checks.push({label,ok,detail});};
    setupFight(); s.partner.body.reset(500,220);
    let st=play.step(100,{punch:true,right:true});
    check('attack slows movement to 60%',Math.abs(st.vx-s.player.controller.opts.speed*0.6)<0.01,st.vx);
    st=play.step(100,{kick:true,headbutt:true});
    check('cannot cancel punch with another attack',st.combat.attack==='punch',st.combat);
    st=play.step(600,{kick:true,headbutt:true});
    check('busy inputs never queue',st.combat.attack===null,st.combat);
    play.step(17,{}); st=play.step(17,{kick:true});
    check('fresh key starts next combo attack',st.combat.attack==='kick',st.combat);
    st=play.step(1800,{kick:true});
    check('holding attack never repeats',st.combat.attack===null,st.combat);
    setupFight(); s.partner.body.reset(500,220);
    st=play.step(17,{block:true});
    st=play.step(100,{block:true,up:true});
    check('moving does not turn block',st.combat.blockFacing==='right'&&st.facing==='right',st.combat);
    check('blocking moves at half speed',Math.abs(st.vy+s.player.controller.opts.speed*0.5)<0.01,st.vy);
    st=play.step(3000,{block:true});
    check('block expires after three seconds',!st.combat.blocking,st.combat);
    st=play.step(1500,{block:true});
    check('held block cannot restart automatically',!st.combat.blocking,st.combat);
    play.step(17,{});st=play.step(17,{block:true,down:true});
    check('release allows a new guard direction',st.combat.blockFacing==='down',st.combat);
    for(const facing of ['up','down','left','right']) for(const incoming of ['up','down','left','right']) {
      setupFight(facing); s.partner.body.reset(500,220);
      play.step(17,{block:true});
      const offset={up:[0,-20],down:[0,20],left:[-20,0],right:[20,0]}[incoming];
      const result=s.combat.receive({x:s.player.x+offset[0],y:s.player.y+offset[1]},ATTACKS.headbutt);
      check(`guard ${facing}, hit ${incoming}`,result.damage===(facing===incoming?2.5:10)&&result.stagger===(facing===incoming?0:350),result);
    }
    setupFight();s.partner.body.reset(500,220);
    s.health.take(20);play.step(44900,{});
    check('no early regeneration',s.health.value===80,s.health.value);
    play.step(1100,{});check('regen is two HP per second',Math.abs(s.health.value-82)<0.04,s.health.value);
    s.health.take(1);play.step(44900,{});check('new damage restarts the wait',Math.abs(s.health.value-81)<0.04,s.health.value);
    const reaches=[];
    for(const direction of ['right','left','up','down']) {
      const range={direction};
      for(const name of ['punch','kick','headbutt']) {
        let farthest=0;
        for(let distance=10;distance<=60;distance+=2) {
          setupFight(direction,distance);play.step(850,{[name]:true});
          if(s.partnerHealth.value<100) farthest=distance;
        }
        range[name]=farthest;
      }
      reaches.push(range);
      check(`kick reaches farther than punch (${direction})`,range.kick>range.punch,range);
    }
    setupFight();s.partner.body.reset(365,220);play.step(17,{});
    return {checks,reaches};
  });
  for(const check of checks.checks) assert.ok(check.ok,check.label+': '+JSON.stringify(check.detail));
  // Confirm actual keyboard mapping as well as deterministic controller input.
  await page.evaluate(()=>window.pixelforgePlay.release());
  await page.keyboard.down('c');await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>window.pixelforgePlay.state().combat.attack),'punch');
  await page.keyboard.up('c');await page.waitForTimeout(500);
  await page.keyboard.down('v');await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>window.pixelforgePlay.state().combat.blocking),true);
  await page.keyboard.up('v');
  await page.waitForTimeout(80);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`previews/${character}-combat-practice.png`});
  await page.goto(`http://127.0.0.1:5173/?character=${character}&solo`);
  await page.waitForFunction(()=>window.pixelforgePlay?.state().level==='brock3');
  assert.equal(await page.evaluate(()=>window.pixelforgePlay.state().health),100);
  assert.ok(await page.evaluate(()=>window.pixelforgePlay.player.combat));
  await page.keyboard.press('2');
  await page.waitForFunction(()=>window.pixelforgePlay?.player.texture.key==='mason');
  await page.keyboard.press('1');
  await page.waitForFunction(()=>window.pixelforgePlay?.player.texture.key==='titus');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,directionalAttackChecks:results.length,mechanicsChecks:checks.checks.length,ranges:checks.reaches,keyboard:true,characterSwitching:true,browserErrors:errors},null,2));
} finally {await browser.close();}
