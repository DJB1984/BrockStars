// Rebuild editable headlock layers, then: python -m pixelforge export mason titus james.
import fs from 'node:fs';
import { ATTACKS } from '../src/combat/rules.js';
const [windup, active, hold, recovery] = ATTACKS.grapple.frames;
const blank = () => Array.from({length:64},()=>Array(64).fill('.'));
function line(g, a, b, r, color) {
  const n=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]),1);
  for(let i=0;i<=n;i++) {
    const x=Math.round(a[0]+(b[0]-a[0])*i/n), y=Math.round(a[1]+(b[1]-a[1])*i/n);
    for(let v=-r;v<=r;v++)for(let u=-r;u<=r;u++)if(u*u+v*v<=r*r+1 && g[y+v]?.[x+u]!==undefined)g[y+v][x+u]=color;
  }
}
function arm(g, points) {
  for(const [r,c] of [[4,'k'],[3,'d'],[2,'m']])for(let i=1;i<points.length;i++)line(g,points[i-1],points[i],r,c);
  const hand=points.at(-1);line(g,hand,hand,3,'k');line(g,hand,hand,2,'S');line(g,[hand[0]-1,hand[1]-1],hand,1,'s');
}
for(const character of ['mason','titus','james']) {
  const dir='sprites/'+character, spec=JSON.parse(fs.readFileSync(dir+'/sprite.json','utf8'));
  for(const [facing,view] of [['down','front'],['up','back'],['side','side']]) {
    const side=view==='side', back=view==='back', tall=character==='james';
    // Bend the upper body and drop the head into the crook of Mason's arm.
    const torso={from:view+'_torso',offset:[side?2:0,3]};
    const head={from:view+'_head',offset:[side?3:0,tall?17:10]};
    const arms={from:view+(side?'_arm':'_arms'),offset:[side?2:0,3]};
    spec.animations['grappled_'+facing]={loop:true,frames:[{layers:[view+'_shadow',view+'_legs_stand',torso,arms,head],duration:180}]};
    if(character!=='mason')continue;
    const reach=blank(), lock=blank();
    if(side) {
      arm(reach,[[31,25],[43,22],[49,24]]);
      arm(lock,[[31,25],[46,29],[51,24],[46,23]]);
      arm(lock,[[30,29],[37,33],[47,28]]);
    } else if(back) {
      arm(reach,[[22,25],[19,18],[25,15]]);arm(reach,[[41,25],[45,18],[40,15]]);
      arm(lock,[[41,25],[50,22],[51,16],[44,15]]);arm(lock,[[22,25],[34,29],[45,24]]);
    } else {
      arm(reach,[[22,25],[19,34],[25,36]]);arm(reach,[[41,25],[45,34],[40,36]]);
      arm(lock,[[22,25],[18,35],[25,39],[36,38]]);arm(lock,[[41,25],[46,34],[40,39],[33,38]]);
    }
    for(const [name,g] of [['grapple_'+view+'_reach',reach],['grapple_'+view+'_lock',lock],['hit_'+view+'_grapple',reach]])fs.writeFileSync(dir+'/frames/'+name+'.txt',g.map(r=>r.join('')).join('\n')+'\n');
    spec.animations['grapple_overlay_'+facing]={loop:true,frames:[{layers:['grapple_'+view+'_lock'],duration:180}]};
    const base=[view+'_shadow',view+'_legs_stand',view+'_torso',view+'_head'];
    const guard=[...base,'combat_'+view+'_other_arm','combat_'+view+'_guard_arm','combat_'+view+'_guard_fist'];
    spec.animations['grapple_'+facing]={loop:false,frames:[
      {layers:[...base,'grapple_'+view+'_reach'],duration:windup},
      {layers:[...base,'hit_'+view+'_grapple'],duration:active,active:true},
      {layers:[...base,'grapple_'+view+'_lock'],duration:hold},
      {layers:guard,duration:recovery},
    ]};
  }
  fs.writeFileSync(dir+'/sprite.json',JSON.stringify(spec,null,character==='james'?2:1)+'\n');
}
console.log('Built Mason Grapple and captive poses for all playable fighters.');
