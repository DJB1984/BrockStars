// node tests/grapple-browser.mjs (Vite on TEST_BASE_URL, default :5173).
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:5173';
try {
  const page=await browser.newPage({viewport:{width:1280,height:760}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?practice=1&character=mason');
  await page.waitForFunction(()=>!!window.pixelforgePlay?.scene?.combat);
  const checks=await page.evaluate(async()=>{
    const play=pixelforgePlay,s=play.scene,out=[];play.freeze();
    const check=(name,ok)=>{if(!ok)throw Error(name);out.push(name);};
    window.resetGrapple=(facing='right',distance=20)=>{
      s.combat.cancelGrapple();s.health.reset();s.partnerHealth.reset();
      const [dx,dy]={right:[distance,0],left:[-distance,0],up:[0,-distance],down:[0,distance]}[facing];
      s.player.body.reset(300,220);s.partner.body.reset(300+dx,220+dy);s.player.controller.facing=facing;
      for(const c of [s.combat,s.partnerCombat]){
        c.rules.attack=null;c.rules.block=null;c.rules.heldBy=null;c.rules.previous={};c.rules.staggerUntil=0;c.rules.knockedDownUntil=0;c.rules.blockReadyAt=0;c.controller.stunnedUntil=0;c.controller.busy=null;
      }
      s.partner.controller.override={};play.step(17,{});
    };
    for(const facing of ['right','left','up','down']){
      resetGrapple(facing);play.step(400,{grapple:true});check('windup '+facing,s.partnerHealth.value===125&&!s.partnerCombat.rules.heldBy);
      play.step(200,{grapple:true});check('captured '+facing,!!s.partnerCombat.rules.heldBy&&s.partnerHealth.value===125);
      check('captive animation '+facing,s.partner.anims.currentAnim.key.includes('grappled'));
      const before=[s.player.x,s.player.y,s.partner.x,s.partner.y];
      const read=s.partner.controller.readInput;s.partner.controller.readInput=()=>({...read(),right:true,punch:true,block:true});
      play.step(1000,{grapple:true,left:true});
      check('both rooted '+facing,before.every((v,i)=>Math.abs(v-[s.player.x,s.player.y,s.partner.x,s.partner.y][i])<.1));
      check('captive cannot act '+facing,!s.partnerCombat.rules.attack&&!s.partnerCombat.rules.block);
      s.partner.controller.readInput=read;
      play.step(1500,{grapple:true});check('25 delayed damage '+facing,s.partnerHealth.value===100&&!s.partnerCombat.rules.heldBy);
      play.step(20000,{grapple:true});check('held S never repeats '+facing,s.partnerHealth.value===100&&s.combat.rules.attack===null);
    }
    resetGrapple();const read=s.partner.controller.readInput;s.partner.controller.readInput=()=>({...read(),block:true});s.partner.controller.facing='left';
    play.step(17,{});play.step(650,{grapple:true});check('front block prevents capture',s.partnerHealth.value===118.75&&!s.partnerCombat.rules.heldBy);s.partner.controller.readInput=read;
    resetGrapple('right',60);play.step(3000,{grapple:true});check('miss costs cooldown',s.partnerHealth.value===125&&s.combat.snapshot().cooldowns.grapple>16000);
    resetGrapple();play.step(650,{grapple:true});s.combat.receive(s.partner,{damage:1,stagger:350,knockback:0});play.step(3000,{});
    check('interruption releases safely',!s.partnerCombat.rules.heldBy&&s.partnerHealth.value===125);
    resetGrapple();return out;
  });
  await page.evaluate(()=>pixelforgePlay.release());
  await page.keyboard.down('s');await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>pixelforgePlay.scene.combat.rules.attack?.name),'grapple');
  assert.equal(await page.evaluate(()=>pixelforgePlay.player.controller.readInput().down),false);
  await page.keyboard.up('s');await page.waitForTimeout(650);
  await page.screenshot({path:'previews/mason-grapple.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,keyboard:true,checks},null,2));
}finally{await browser.close();}
