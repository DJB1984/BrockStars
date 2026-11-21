import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const b=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
try {
  const p=await b.newPage({viewport:{width:1280,height:760}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto((process.env.TEST_BASE_URL??'http://127.0.0.1:5173')+'/?practice=1&character=james');
  await p.waitForFunction(()=>!!window.pixelforgePlay?.scene?.combat);
  const checks=await p.evaluate(async()=>{
    const play=pixelforgePlay,s=play.scene;play.freeze();const out=[];
    const check=(name,ok)=>{if(!ok)throw Error(name);out.push(name);};
    window.resetBellow=(dx=60,dy=0)=>{
      s.combat.cancelGrapple();s.health.reset();s.partnerHealth.reset();
      for(const c of [s.combat,s.partnerCombat]) {c.rules.attack=null;c.rules.block=null;c.rules.heldBy=null;c.rules.previous={};c.rules.staggerUntil=0;c.rules.knockedDownUntil=0;c.rules.blockReadyAt=0;c.controller.stunnedUntil=0;c.push=null;c.controller.busy=null;}
      s.player.body.reset(300,220);s.partner.body.reset(300+dx,220+dy);s.player.controller.facing='right';s.partner.controller.override={};play.step(17,{});
    };
    for(const [dx,dy] of [[80,0],[-80,0],[0,70],[0,-70],[112,50]]){
      resetBellow(dx,dy);play.step(300,{bellow:true});check('windup '+dx+','+dy,s.partnerHealth.value===125);
      play.step(150,{bellow:true});check('10 damage '+dx+','+dy,s.partnerHealth.value===115);
      check('stunned animation '+dx+','+dy,s.partner.anims.currentAnim.key.includes('stunned'));
      const start=[s.partner.hitFreeze?.x??s.partner.x,s.partner.hitFreeze?.y??s.partner.y],read=s.partner.controller.readInput;
      s.partner.controller.readInput=()=>({...read(),right:true,punch:true,block:true});s.partnerHealth.quiet=45000;
      check('direct healing blocked '+dx+','+dy,s.partnerHealth.heal(10)===0);
      play.step(4700,{bellow:true});check('rooted for five seconds '+dx+','+dy,s.partner.x===start[0]&&s.partner.y===start[1]&&!s.partnerCombat.rules.attack&&!s.partnerCombat.rules.block);
      check('regen blocked '+dx+','+dy,s.partnerHealth.value===115);
      play.step(400,{});check('movement resumes '+dx+','+dy,s.partner.x>start[0]);s.partner.controller.readInput=read;
      check('cooldown running '+dx+','+dy,s.combat.snapshot().cooldowns.bellow>19000);
    }
    resetBellow(161,0);play.step(1100,{bellow:true});check('outside ten blocks misses',s.partnerHealth.value===125&&!s.partnerCombat.snapshot().stunRemaining);
    resetBellow(160,0);play.step(700,{bellow:true});check('ten-block boundary hits',s.partnerHealth.value===115);
    resetBellow(50,0);const read=s.partner.controller.readInput;s.partner.controller.readInput=()=>({...read(),block:true});s.partner.controller.facing='left';
    play.step(17,{});play.step(500,{bellow:true});check('block cannot prevent stun',s.partnerHealth.value===115&&s.partnerCombat.snapshot().stunRemaining>4700);s.partner.controller.readInput=read;
    play.step(25000,{bellow:true});check('holding S does not repeat',s.combat.rules.attack===null&&s.partnerHealth.value===115);
    resetBellow();play.step(150,{bellow:true});s.combat.receive(s.partner,{damage:1,stagger:350,knockback:0});play.step(900,{});
    check('windup can be interrupted',s.partnerHealth.value===125);
    resetBellow();return out;
  });
  await p.evaluate(()=>pixelforgePlay.release());await p.keyboard.down('s');await p.waitForTimeout(100);
  assert.equal(await p.evaluate(()=>pixelforgePlay.scene.combat.rules.attack?.name),'bellow');
  assert.equal(await p.evaluate(()=>pixelforgePlay.player.controller.readInput().down),false);await p.keyboard.up('s');
  await p.waitForTimeout(500);await p.screenshot({path:'previews/james-bellow.png'});
  await p.evaluate(async()=>{const {touch}=await import('/src/combat/touch.js');const c=pixelforgePlay.scene.combat;c.rules.attack=null;c.rules.readyAt.bellow=0;c.rules.previous={};touch.takedown=true;});
  await p.waitForTimeout(80);assert.equal(await p.evaluate(()=>pixelforgePlay.scene.combat.rules.attack?.name),'bellow');
  await p.evaluate(async()=>{const {releaseTouch}=await import('/src/combat/touch.js');releaseTouch();});
  for(const facing of ['up','down','right']) {
    await p.evaluate(facing=>{const play=pixelforgePlay;play.freeze();resetBellow();play.player.controller.facing=facing;play.step(600,{bellow:true});},facing);
    await p.screenshot({path:'previews/james-bellow-'+facing+'.png'});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,keyboardS:true,touchSuper:true,checks},null,2));
}finally{await b.close();}
