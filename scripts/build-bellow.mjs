// Build James's shout and every fighter's stun poses without rebuilding their existing art.
// Run this after build-james.mjs, then pixelforge export james mason titus.
import fs from 'node:fs';
import { ATTACKS } from '../src/combat/rules.js';
const frame=(layers,duration)=>({layers,duration});
for(const id of ['james','mason','titus']) {
  const dir='sprites/'+id, spec=JSON.parse(fs.readFileSync(dir+'/sprite.json','utf8'));
  for(const [facing,view] of [['down','front'],['up','back'],['side','side']]) {
    const side=view==='side', tall=id==='james';
    const body=[view+'_shadow',view+'_legs_stand',view+'_torso',view+(side?'_arm':'_arms')];
    spec.animations['stunned_'+facing]={loop:true,frames:[
      frame([...body,{from:view+'_head',offset:[1,1]}],220),
      frame([...body,{from:view+'_head',offset:[-1,2]}],220),
    ]};
    if(!tall)continue;
    const read=name=>fs.readFileSync(dir+'/frames/'+name+'.txt','utf8').trimEnd().split(/\r?\n/).map(r=>[...r]);
    const head=read(view+'_head'), arms=Array.from({length:80},()=>Array(64).fill('.'));
    const dot=(g,x,y,r,c)=>{for(let v=-r;v<=r;v++)for(let u=-r;u<=r;u++)if(u*u+v*v<=r*r+1&&g[y+v]?.[x+u]!==undefined)g[y+v][x+u]=c;};
    const line=(g,a,b,r,c)=>{const n=Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),1);for(let i=0;i<=n;i++)dot(g,Math.round(a[0]+(b[0]-a[0])*i/n),Math.round(a[1]+(b[1]-a[1])*i/n),r,c);};
    const limb=points=>{for(const [r,c] of [[4,'k'],[3,'d'],[2,'m']])for(let i=1;i<points.length;i++)line(arms,points[i-1],points[i],r,c);const p=points.at(-1);dot(arms,p[0],p[1],3,'k');dot(arms,p[0],p[1],2,'S');dot(arms,p[0]-1,p[1]-1,1,'s');};
    if(side) {limb([[30,37],[24,42],[21,34]]);limb([[37,36],[45,42],[49,34]]);}
    else {limb([[22,36],[15,42],[13,34]]);limb([[41,36],[48,42],[50,34]]);}
    if(view!=='back') {
      const x=side?38:32;
      dot(head,x,30,4,'k');dot(head,x,31,2,'e');line(head,[x-2,28],[x+2,28],0,'W');dot(head,x,33,1,'S');
    }
    for(const [name,g] of [['bellow_'+view+'_head',head],['bellow_'+view+'_arms',arms]])fs.writeFileSync(dir+'/frames/'+name+'.txt',g.map(r=>r.join('')).join('\n')+'\n');
    const base=[view+'_shadow',view+'_legs_stand',view+'_torso'];
    const idle=[...body,view+'_head'];
    const prepare=[...base,{from:view+'_head',offset:[side?-1:0,1]},'combat_'+view+'_guard_arm','combat_'+view+'_guard_fist'];
    const shout=[...base,'bellow_'+view+'_head','bellow_'+view+'_arms'];
    spec.animations['bellow_'+facing]={loop:false,frames:[frame(prepare,ATTACKS.bellow.frames[0]),frame(shout,ATTACKS.bellow.frames[1]),frame(shout,ATTACKS.bellow.frames[2]),frame(idle,ATTACKS.bellow.frames[3])]};
  }
  fs.writeFileSync(dir+'/sprite.json',JSON.stringify(spec,null,id==='james'?2:1)+'\n');
}
console.log('Built Bellow shout and directional stun poses.');
