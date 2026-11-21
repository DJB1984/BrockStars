import Phaser from 'phaser';
import { addPixelforgePlayer, pixelforgeFeel, installPixelforgePlay, drawPixelforgeBoxes, playFacing } from '../../export/pixelforge.js';
import { TitusCombat } from '../combat/TitusCombat.js';
import { HitFeel } from '../combat/hitFeel.js';
import { FightMarks } from '../combat/fightMarks.js';
import { CHARACTERS, isCharacter } from '../characters.js';
import { HealthPool, directionTo, ATTACKS, DODGE } from '../combat/rules.js';

export class CombatPractice extends Phaser.Scene {
  constructor() { super('combat-practice'); }
  create() {
    const requested = new URLSearchParams(location.search).get('character');
    const character = isCharacter(requested) ? requested : 'titus';
    this.characterLabel = CHARACTERS[character].name;
    this.physics.world.setBounds(24, 100, 592, 200);
    this.cameras.main.setBackgroundColor('#171c29');
    const floor = this.add.graphics().setDepth(-5000);   // under the rings fightMarks.js draws at the feet
    floor.fillStyle(0x242d3e).fillRoundedRect(24, 90, 592, 220, 8);
    floor.lineStyle(1, 0x303c50);
    for (let x=40; x<616; x+=24) floor.lineBetween(x,100,x,300);
    for (let y=108; y<300; y+=24) floor.lineBetween(24,y,616,y);
    floor.lineStyle(2,0x52657c).strokeRoundedRect(24,90,592,220,8);
    const text = (x,y,value,size=12,color='#edf0f5') => this.add.text(x,y,value,{fontFamily:'monospace',fontSize:`${size}px`,color}).setDepth(200000);
    text(24,14,`${this.characterLabel.toUpperCase()} / COMBAT PRACTICE`,16,'#f0bb7e');
    const stats = CHARACTERS[character];
    this.special = Object.entries(ATTACKS).find(([, spec]) => spec.character === character);
    text(24,38,`C Punch ${stats.punch}  X Kick ${stats.kick}  Z Headbutt ${stats.headbutt}  Hold V Block${this.special ? `  S ${this.special[0]} ${this.special[1].damage}` : ''}${DODGE.enabled ? '  Shift Dodge' : ''}`,10);
    this.status=text(24,58,'',11);
    this.message=text(24,320,'Approach the partner to test your attacks.',11,'#aabbd1');
    text(24,340,'Arrows Move   P Sparring on/off   R Reset   B Hitboxes',10,'#aabbd1');
    this.feel=pixelforgeFeel(this);
    this.player=addPixelforgePlayer(this,280,220,character,{speed:CHARACTERS[character].speed});
    this.partner=addPixelforgePlayer(this,345,220,'titus',{speed:CHARACTERS.titus.speed});
    this.partner.controller.override={};
    this.health=new HealthPool();
    this.partnerHealth=new HealthPool();
    const report=(target,attack,result) => {
      if (result?.perfect) this.message.setText(`${target===this.player?this.characterLabel:'Partner'}: perfect block! The ${attack} bounced off.`);
      if (result?.damage) this.message.setText(`${target===this.player?this.characterLabel:'Partner'}: ${result.blocked?'blocked ':''}${attack}, -${result.damage} HP${result.stagger?' / staggered':''}`);
    };
    this.hitFeel=new HitFeel(this,{me:()=>this.player});
    const landed=(attacker)=>(target,attack,result)=>{report(target,attack,result);this.hitFeel.land(attacker,target,attack,result);};
    const onWhiff=(sprite,move,facing)=>this.hitFeel.whiff(sprite,move,facing);
    this.combat=new TitusCombat(this,this.player,{health:this.health,targets:()=>[this.partner],onHit:landed(this.player),onWhiff});
    this.partnerCombat=new TitusCombat(this,this.partner,{health:this.partnerHealth,targets:()=>[this.player],onHit:landed(this.partner),onWhiff});
    // Rings, "MASH!" and wind-up telegraphs for both fighters, as in a level.
    const superReady=(c)=>{const move=Object.keys(ATTACKS).find(n=>ATTACKS[n].character===c.rules.character);return !!move&&c.rules.health.value>0&&this.time.now>=(c.rules.readyAt[move]??0);};
    const marked=(c,mine)=>({sprite:c.sprite,mine,alive:c.rules.health.value>0,superReady:superReady(c),mash:!!c.rules.heldBy||this.time.now<c.rules.stunUntil});
    this.marks=new FightMarks(this,()=>[marked(this.combat,true),marked(this.partnerCombat,false)]);
    this.marks.follow(this.combat);this.marks.follow(this.partnerCombat);
    this.player.controller.facing='right';
    this.partner.controller.facing='left';
    playFacing(this.player,'idle','right');
    playFacing(this.partner,'idle','left');
    this.labels=[text(40,108,'',11),text(420,108,'',11,'#b1d4ff')];
    this.sparring=false;
    this.nextStrike=0;
    this.strikeIndex=0;
    this.controls=this.input.keyboard.addKeys('P,R,B');
    this.debug=this.add.graphics().setDepth(199999);
    installPixelforgePlay(this,{name:'combat-practice',player:this.player},{extra:()=>({health:this.health.value,partnerHealth:this.partnerHealth.value,combat:this.combat.snapshot(),partnerCombat:this.partnerCombat.snapshot(),sparring:this.sparring})});
  }
  update(time,delta) {
    this.health.update(delta); this.partnerHealth.update(delta);
    if (Phaser.Input.Keyboard.JustDown(this.controls.P)) { this.sparring=!this.sparring; this.nextStrike=time+600; }
    if (Phaser.Input.Keyboard.JustDown(this.controls.R)) { this.scene.restart(); return; }
    if (Phaser.Input.Keyboard.JustDown(this.controls.B)) this.showBoxes=!this.showBoxes;
    const dx=this.player.x-this.partner.x,dy=this.player.y-this.partner.y;
    if (!this.partnerCombat.rules.attack && !this.partnerCombat.rules.block) this.partner.controller.facing=directionTo(dx,dy)??'left';
    const input={};
    if (this.sparring && this.health.value>0 && this.partnerHealth.value>0 && time>=this.nextStrike && Math.hypot(dx,dy)<42) {
      input[['punch','kick','headbutt'][this.strikeIndex++%3]]=true;
      this.nextStrike=time+2000;
    }
    this.partner.controller.override=this.partnerKeys??input;   // a test drives the partner by setting partnerKeys
    const c=this.combat.snapshot();
    const block=c.blocking?`Blocking ${c.blockFacing} ${(c.blockRemaining/1000).toFixed(1)}s`:c.blockCooldown?`Block ready in ${(c.blockCooldown/1000).toFixed(1)}s`:'Block ready';
    const left = this.special ? c.cooldowns[this.special[0]] : 0;
    const special = this.special ? ` | S ${left ? `${(left/1000).toFixed(1)}s` : 'Ready'}` : '';
    this.status.setText(`${block} | Sparring ${this.sparring?'ON':'OFF'} | ${c.stunRemaining ? `Stunned ${(c.stunRemaining/1000).toFixed(1)}s / healing blocked` : c.held ? 'In headlock' : c.knockdownRemaining ? 'Knocked down' : c.attack??'Ready'}${special}`);
    [this.health,this.partnerHealth].forEach((health,i)=>this.labels[i].setText(`${i?'Partner':this.characterLabel} ${Math.round(health.value*10)/10}/${health.max}`));
    if (!this.health.value || !this.partnerHealth.value) this.message.setText('0 HP reached. Press R to reset this practice session.');
    this.debug.clear();
    if (this.showBoxes) {
      drawPixelforgeBoxes(this.debug,[this.player,this.partner]);
      this.combat.drawReach(this.debug);this.partnerCombat.drawReach(this.debug);
    }
  }
}
