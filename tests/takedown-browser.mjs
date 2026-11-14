// Run against the Vite dev server: node tests/takedown-browser.mjs.
// Uses installed Playwright, or PLAYWRIGHT_MODULE from the bundled runtime.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const baseUrl=process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
try {
  const page=await browser.newPage({viewport:{width:1280,height:760}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const evaluate=expression=>page.evaluate(expression);
  await page.goto(`${baseUrl}/?practice=1&character=titus`);
  await page.waitForFunction(()=>!!window.pixelforgePlay?.scene?.combat);
  const result=await evaluate(`(async()=>{
    const play=window.pixelforgePlay,s=play.scene;play.freeze();
    const checks=[];const check=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
    window.resetTakedown=(facing='right',distance=20)=>{
      s.health.reset();s.partnerHealth.reset();
      const [dx,dy]={right:[distance,0],left:[-distance,0],up:[0,-distance],down:[0,distance]}[facing];
      s.player.body.reset(300,220);s.partner.body.reset(300+dx,220+dy);
      s.player.controller.facing=facing;
      for(const c of [s.combat,s.partnerCombat]) {
        c.rules.attack=null;c.rules.block=null;c.rules.previous={};c.rules.blockReadyAt=0;
        c.rules.staggerUntil=0;c.rules.knockedDownUntil=0;c.controller.stunnedUntil=0;c.controller.busy=null;
      }
      play.step(17,{});
    };
    for(const facing of ['right','left','up','down']) {
      resetTakedown(facing);
      play.step(450,{takedown:true});check('wind-up '+facing,s.partnerHealth.value===100);
      play.step(150,{takedown:true});check('25 damage '+facing,s.partnerHealth.value===75);
      check('knockdown animation '+facing,s.partner.anims.currentAnim.key.includes('knockdown'));
      check('knockdown duration '+facing,s.partnerCombat.snapshot().knockdownRemaining>1300);
      const victimFacing={right:'left',left:'right',up:'down',down:'up'}[facing];
      check('victim faces impact '+facing,s.partner.controller.facing===victimFacing);
      const victimView=['left','right'].includes(victimFacing)?'side':victimFacing;
      check('directional knockdown pose '+facing,s.partner.anims.currentAnim.key==='titus_knockdown_'+victimView && s.partner.flipX===(victimFacing==='left'));
      play.step(1700,{takedown:true});check('held S never repeats '+facing,s.combat.rules.attack===null && s.partnerHealth.value===75);
      check('automatic recovery '+facing,s.partnerCombat.snapshot().knockdownRemaining===0 && !s.partner.anims.currentAnim.key.includes('knockdown'));
    }
    resetTakedown();s.partner.controller.facing='left';
    const readPartner=s.partner.controller.readInput;
    s.partner.controller.readInput=()=>({...readPartner(),block:true});
    play.step(17,{});play.step(650,{takedown:true});
    check('block reduces damage',s.partnerHealth.value===93.75);
    check('block prevents knockdown',s.partnerCombat.snapshot().knockdownRemaining===0);
    s.partner.controller.readInput=readPartner;
    resetTakedown('right',30);play.step(1200,{takedown:true});
    check('miss consumes cooldown',s.partnerHealth.value===100 && s.combat.snapshot().cooldowns.takedown>18000);
    play.step(17,{});play.step(1200,{takedown:true});check('cooldown prevents retry',s.combat.rules.attack===null);
    resetTakedown('right',50);play.step(650,{takedown:true});s.partner.body.reset(320,220);
    play.step(300,{takedown:true});check('recovery frames cannot hit',s.partnerHealth.value===100);
    resetTakedown();play.step(100,{takedown:true,right:true});check('Titus is rooted',s.player.body.velocity.length()===0);
    resetTakedown();return checks;
  })()`);
  await evaluate('window.pixelforgePlay.release()');
  await page.keyboard.down('s');
  await pause(120);
  const keyboard=await evaluate(`({attack:pixelforgePlay.scene.combat.rules.attack?.name,facing:pixelforgePlay.player.controller.facing,down:pixelforgePlay.player.controller.readInput().down})`);
  assert.equal(keyboard.attack,'takedown');assert.equal(keyboard.facing,'right');assert.equal(keyboard.down,false);
  await page.keyboard.up('s');
  await pause(680);
  await page.screenshot({path:'previews/titus-takedown.png'});
  await page.goto(`${baseUrl}/?solo&character=titus`);
  await page.waitForFunction(()=>!!window.pixelforgePlay?.player?.combat);
  await page.keyboard.down('s');await pause(100);await page.keyboard.up('s');
  assert.ok(await evaluate('pixelforgePlay.scene.combat.snapshot().cooldowns.takedown>19000'));
  await page.keyboard.press('2');await page.waitForFunction(()=>pixelforgePlay.player.texture.key==='mason');
  await page.keyboard.press('1');await page.waitForFunction(()=>pixelforgePlay.player.texture.key==='titus');
  assert.ok(await evaluate('pixelforgePlay.scene.combat.snapshot().cooldowns.takedown>18000'));
  await page.keyboard.down('ArrowDown');await pause(100);
  assert.ok(await evaluate('pixelforgePlay.player.body.velocity.y>0'));
  await page.keyboard.up('ArrowDown');
  for(const character of ['mason','titus']) {
    await page.keyboard.press(character==='mason'?'2':'1');
    await page.waitForFunction(character=>pixelforgePlay.player.texture.key===character,character);
    for(const key of ['w','a','s','d']) {
      await page.keyboard.down(key);await pause(50);
      const input=await evaluate('pixelforgePlay.player.controller.readInput()');
      assert.ok(!input.up && !input.down && !input.left && !input.right,character+' '+key+' cannot move');
      await page.keyboard.up(key);
    }
    for(const [key,direction] of [['ArrowUp','up'],['ArrowDown','down'],['ArrowLeft','left'],['ArrowRight','right']]) {
      await page.keyboard.down(key);await pause(40);
      assert.equal(await evaluate('pixelforgePlay.player.controller.readInput().'+direction),true,character+' '+key+' moves');
      await page.keyboard.up(key);
    }
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:result,keyboard,cooldownSurvivesCharacterSwitch:true,arrowOnlyMovementBothCharacters:true},null,2));
} finally {await browser.close();}
