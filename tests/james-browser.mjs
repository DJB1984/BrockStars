// James selection, movement, shared walk rig, special restriction, and knockdown recovery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base=process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-features=WebRtcHideLocalIpsWithMdns']});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:760}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.locator('.lobby input[value="james"]').check();
  await page.locator('[data-act="solo"]').click();
  await page.waitForFunction(()=>window.pixelforgePlay?.player.texture.key==='james');
  assert.equal(await page.evaluate(()=>pixelforgePlay.player.controller.opts.speed),126);
  const original=await page.evaluate(()=>({x:pixelforgePlay.player.x,y:pixelforgePlay.player.y}));
  for(const [key,character,speed]of [['1','titus',140],['2','mason',154],['3','james',126]]){
    await page.keyboard.press(key);
    await page.waitForFunction(character=>window.pixelforgePlay?.player.texture.key===character,character);
    const actual=await page.evaluate(()=>({x:pixelforgePlay.player.x,y:pixelforgePlay.player.y,speed:pixelforgePlay.player.controller.opts.speed}));
    assert.equal(actual.speed,speed);assert.ok(Math.abs(actual.x-original.x)<1);assert.ok(Math.abs(actual.y-original.y)<1);
  }
  await page.goto(`${base}/?practice=1&character=james`);
  await page.waitForFunction(()=>window.pixelforgePlay?.scene.combat);
  const checks=await page.evaluate(async()=>{
    const play=pixelforgePlay,s=play.scene;play.freeze();
    const {ATTACKS}=await import('/src/combat/rules.js');
    const checks=[];
    function reset(){
      s.health.reset();s.partnerHealth.reset();
      s.player.body.reset(300,220);s.partner.body.reset(550,220);
      for(const c of [s.combat,s.partnerCombat]){
        Object.assign(c.rules,{attack:null,block:null,previous:{},blockReadyAt:0,staggerUntil:0,knockedDownUntil:0});
        c.controller.stunnedUntil=0;c.controller.busy=null;
      }
      play.step(17,{});
    }
    const check=(name,ok,actual)=>{if(!ok)throw new Error(`${name}: ${JSON.stringify(actual)}`);checks.push(name);};
    for(const [name,input]of [['right',{right:true}],['left',{left:true}],['up',{up:true}],['down',{down:true}],['diagonal',{right:true,up:true}]]){
      reset();const st=play.step(100,input);
      check(`126 speed ${name}`,Math.abs(Math.hypot(st.vx,st.vy)-126)<0.01,st);
      check(`walking animation ${name}`,s.player.anims.currentAnim.key.startsWith('james_walk_'),st);
    }
    reset();let st=play.step(100,{right:true,block:true});
    check('63 speed while blocking',Math.abs(st.vx-63)<0.01,st);
    reset();st=play.step(100,{right:true,punch:true});
    check('75.6 speed while attacking',Math.abs(st.vx-75.6)<0.01,st);
    reset();st=play.step(700,{takedown:true});
    check('special is unassigned',!s.combat.rules.attack && s.combat.snapshot().cooldowns.takedown===0,st);
    for(const facing of ['left','right','up','down']){
      reset();
      const [dx,dy]={left:[-20,0],right:[20,0],up:[0,-20],down:[0,20]}[facing];
      s.combat.receive({x:s.player.x+dx,y:s.player.y+dy},ATTACKS.takedown);
      const dir=['left','right'].includes(facing)?'side':facing;
      check(`incoming takedown ${facing}`,s.health.value===175 && s.player.anims.currentAnim.key===`james_knockdown_${dir}`,s.combat.snapshot());
      play.step(1700,{});
      check(`get up ${facing}`,s.combat.snapshot().knockdownRemaining===0 && !s.player.anims.currentAnim.key.includes('knockdown'),s.combat.snapshot());
    }
    reset();play.step(100,{right:true});play.step(17,{});
    return checks;
  });
  const james=JSON.parse(fs.readFileSync('sprites/james/sprite.json'));
  const mason=JSON.parse(fs.readFileSync('sprites/mason/sprite.json'));
  for(const dir of ['down','up','side']){
    assert.deepEqual(james.animations[`walk_${dir}`],mason.animations[`walk_${dir}`]);
    for(const action of ['punch','kick','headbutt','block'])assert.deepEqual(james.animations[`${action}_${dir}`],mason.animations[`${action}_${dir}`]);
  }
  await page.screenshot({path:'previews/james-practice-ready.png'});
  await page.goto(`${base}/?solo&character=james`);
  await page.waitForFunction(()=>window.pixelforgePlay?.player.texture.key==='james');
  await page.screenshot({path:'previews/james-in-game.png'});
  // James must also pass the host's character allowlist when joining as a guest.
  const hostContext=await browser.newContext({viewport:{width:1280,height:760}});
  const host=await hostContext.newPage();
  host.on('pageerror',e=>errors.push(e.message));
  try {
    await host.goto(base+'/?solo&character=titus');
    await host.waitForFunction(()=>window.pixelforgePlay?.player.combat);
    const room=await host.evaluate(async()=>{await brockNet.host({name:'Titus host',level:'brock3'});return brockNet.room;});
    await page.evaluate(async room=>{await brockNet.join({name:'James guest',room});},room);
    await host.waitForFunction(()=>brockNet.count===2 && Object.values(brockNet.players).some(p=>p.char==='james'));
    await page.waitForFunction(()=>brockNet.count===2);
    await host.evaluate(()=>{pixelforgePlay.player.controller.override={};pixelforgePlay.player.body.reset(1200,650);});
    await page.evaluate(()=>{const p=pixelforgePlay.player;p.controller.override={};p.body.reset(1220,650);p.controller.facing='left';});
    await new Promise(resolve=>setTimeout(resolve,250));
    await page.evaluate(()=>{pixelforgePlay.player.controller.override={punch:true};});
    await host.waitForFunction(()=>pixelforgePlay.state().health===120);
    await host.waitForFunction(()=>[...pixelforgePlay.scene.remotes.shown.values()].some(r=>r.sprite.texture.key==='james'));
  } finally {
    await page.evaluate(()=>window.brockNet?.leave());
    await host.evaluate(()=>window.brockNet?.leave());
    await hostContext.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,lobbySelection:true,threeFighters:true,sameWalkAndAttackRig:true,guestMultiplayer:true,checks,errors},null,2));
} finally {await browser.close();}
