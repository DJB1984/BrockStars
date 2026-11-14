// Editable Pixel Forge layers. Run this, then pixelforge export titus mason.
import fs from 'node:fs';
import path from 'node:path';
import { ATTACKS } from '../src/combat/rules.js';

for (const character of ['titus', 'mason']) {
  const root = path.join('sprites', character), dir = path.join(root, 'frames');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'sprite.json'), 'utf8'));
  const blank = () => Array.from({length:64}, () => Array(64).fill('.'));
  function line(g, a, b, width, color) {
    const steps = Math.max(Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]), 1);
    for (let i=0;i<=steps;i++) {
      const x=Math.round(a[0]+(b[0]-a[0])*i/steps), y=Math.round(a[1]+(b[1]-a[1])*i/steps);
      for(let dy=-width;dy<=width;dy++) for(let dx=-width;dx<=width;dx++) {
        if(dx*dx+dy*dy<=width*width+1 && g[y+dy]?.[x+dx]!==undefined) g[y+dy][x+dx]=color;
      }
    }
  }
  function limb(g, points, width=3) {
    for(let i=1;i<points.length;i++) line(g,points[i-1],points[i],width+1,'k');
    for(let i=1;i<points.length;i++) line(g,points[i-1],points[i],width,'d');
    for(let i=1;i<points.length;i++) line(g,points[i-1].map(v=>v-1),points[i].map(v=>v-1),width-1,'m');
    for(let i=1;i<points.length;i++) line(g,[points[i-1][0]-2,points[i-1][1]-1],[points[i][0]-2,points[i][1]-1],0,'g');
  }
  function save(name,g) { fs.writeFileSync(path.join(dir,`${name}.txt`),g.map(r=>r.join('')).join('\n')+'\n'); return name; }
  const read=name=>fs.readFileSync(path.join(dir,`${name}.txt`),'utf8').trimEnd().split(/\r?\n/).map(row=>[...row]);
  function stamp(grid,source,dx=0,dy=0,lean=0) {
    source.forEach((row,y)=>row.forEach((color,x)=>{
      const px=Math.round(x+dx+lean*Math.max(0,Math.min(1,(36-y)/18))),py=y+dy;
      if(color!=='.' && grid[py]?.[px]!==undefined) grid[py][px]=color;
    }));
  }
  const entry=(layers,duration,active=false)=>({layers,duration,...(active?{active:true}:{})});
  const flat=blank();
  limb(flat,[[27,25],[26,17],[24,11]],3);
  limb(flat,[[36,25],[38,17],[40,11]],3);
  line(flat,[22,10],[26,10],3,'k'); line(flat,[38,10],[42,10],3,'k');
  line(flat,[31,25],[31,35],8,'k'); line(flat,[31,25],[31,35],7,'m');
  line(flat,[27,25],[27,34],2,'g'); line(flat,[32,27],[32,35],2,character==='titus'?'w':'t');
  limb(flat,[[25,28],[19,30],[16,36]],2); limb(flat,[[38,28],[45,30],[48,36]],2);
  line(flat,[16,37],[16,38],2,'s'); line(flat,[48,37],[48,38],2,'s');
  // This base pose faces north: feet toward the attacker, head falling south.
  // Turn the face with the body rather than attaching an upright head to every pose.
  const head=fs.readFileSync(path.join(dir,'front_head.txt'),'utf8').trimEnd().split(/\r?\n/).map(row=>[...row]);
  const pixels=head.flatMap((row,y)=>row.flatMap((color,x)=>color==='.'?[]:[{x,y,color}]));
  const minY=Math.min(...pixels.map(p=>p.y)),maxY=Math.max(...pixels.map(p=>p.y));
  const minX=Math.min(...pixels.map(p=>p.x)),maxX=Math.max(...pixels.map(p=>p.x));
  for(const {x,y,color} of pixels) flat[minY+maxY-y+28][minX+maxX-x]=color;
  const rotate=(grid,turns)=>{
    let result=grid;
    for(let i=0;i<turns;i++) result=Array.from({length:64},(_,y)=>Array.from({length:64},(_,x)=>result[63-x][y]));
    return result;
  };
  for(const [facing,view] of [['down','front'],['up','back'],['side','side']]) {
    const idle=json.animations[`idle_${facing}`].frames[0];
    const lying=[save(facing==='up'?'takedown_on_back':`takedown_on_back_${facing}`,rotate(flat,{up:0,down:2,side:1}[facing]))];
    const standing=blank();
    for(const layer of ['legs_stand','torso',view==='side'?'arm':'arms','head']) stamp(standing,read(`${view}_${layer}`));
    function falling(amount) {
      const grid=blank();
      if(facing==='side') {
        // Rotate around the torso so the victim topples as a solid body.
        const angle=-amount*Math.PI/2,cos=Math.cos(angle),sin=Math.sin(angle);
        for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
          const sx=Math.round(cos*(x-32)+sin*(y-32)+32);
          const sy=Math.round(-sin*(x-32)+cos*(y-32)+32);
          grid[y][x]=standing[sy]?.[sx]??'.';
        }
        return save(`combat_${view}_takedown_fall_${amount===0.4?'lean':'collapse'}`,grid);
      }
      // Lean away from the forearm, then fold as the hooked leg gives way.
      standing.forEach((row,y)=>row.forEach((color,x)=>{
        if(color==='.') return;
        const height=50-y;
        const px=x;
        const py=Math.round(50-height*(1-amount*0.55)+(facing==='up'?height*amount*0.25:0));
        if(grid[py]?.[px]!==undefined) grid[py][px]=color;
      }));
      return save(`combat_${view}_takedown_fall_${amount===0.4?'lean':'collapse'}`,grid);
    }
    json.animations[`knockdown_${facing}`]={loop:false,frames:[
      entry([falling(0.4)],80),entry([falling(0.9)],70),
      entry(lying,70),entry([{layers:lying,offset:[0,-1]}],80),entry(lying,900),
      entry([{from:idle,offset:[0,9]}],150),entry([idle],150),
    ]};
    if(character!=='titus') continue;
    const side=view==='side', up=view==='back';
    const timing=ATTACKS.takedown.frames;
    // Whole-body poses: load weight, step inside, hook, drive, and hold a low finish.
    // The opponent is only vulnerable at the drive, after the full 500ms commitment.
    const poses=[
      {name:'load',shift:-2,drop:2,lean:-2,step:0,hook:0,arm:0,duration:180},
      {name:'step',shift:1,drop:2,lean:2,step:5,hook:0,arm:1,duration:180},
      {name:'hook',shift:2,drop:4,lean:4,step:8,hook:1,arm:2,duration:timing[0]-360},
      {name:'drive',shift:3,drop:5,lean:6,step:9,hook:1,arm:3,duration:timing[1]/2,active:true},
      {name:'slam',shift:3,drop:7,lean:7,step:9,hook:1,arm:4,duration:timing[1]/2,active:true},
      {name:'follow',shift:2,drop:7,lean:6,step:7,hook:0,arm:4,duration:timing[2]},
      {name:'hold',shift:1,drop:5,lean:3,step:4,hook:0,arm:3,duration:180},
      {name:'rise',shift:0,drop:2,lean:0,step:1,hook:0,arm:0,duration:timing[3]-180},
    ];
    json.animations[`takedown_${facing}`]={loop:false,frames:poses.map(p=>{
      const g=blank(),arms=blank();
      const dx=side?p.shift:0,dy=side?p.drop:p.drop+(up?-1:1)*Math.max(0,p.shift);
      const torsoLean=side?p.lean:0;
      function boot(at) {
        line(g,[at[0]-2,at[1]],[at[0]+3,at[1]],3,'k');
        line(g,[at[0]-2,at[1]-1],[at[0]+3,at[1]-1],1,'D');
      }
      const hips=side?[[29+dx,36+dy],[33+dx,36+dy]]:[[26,36+dy],[37,36+dy]];
      const backFoot=side?[24,50]:[23,50];
      const leadFoot=side?[37+p.step,50-(p.hook?3:0)]:[40+p.hook*4,up?49-p.step:50+p.step/3];
      leadFoot[1]=Math.round(leadFoot[1]);
      limb(g,[hips[0],side?[24,43+Math.min(p.drop,4)]:[23,44],backFoot],3);boot(backFoot);
      limb(g,[hips[1],side?[39+p.step/2,43]:[42,42+(up?-1:1)*p.step/3],leadFoot],3);boot(leadFoot);
      // Curl the ankle around the victim's leg; never extend into a straight kick.
      if(p.hook) limb(g,[leadFoot,[leadFoot[0]-(side?5:3),leadFoot[1]-4]],2);
      stamp(g,read(`${view}_torso`),dx,dy,torsoLean);
      stamp(g,read(`${view}_head`),dx+torsoLean,dy);
      const shoulder=side?[31+dx+torsoLean,24+dy]:[43,24+dy];
      const sideElbows=[[37,31],[43,29],[49,29],[50,33],[50,36]];
      const sideHands=[[38,22],[46,22],[53,20],[55,22],[55,26]];
      const elbow=side?[sideElbows[p.arm][0],sideElbows[p.arm][1]+dy]:[46,30+dy+(up?-1:1)*p.arm];
      const hand=side?[sideHands[p.arm][0],sideHands[p.arm][1]+dy]:[35,26+dy+(up?-1:1)*p.arm*3];
      limb(arms,[shoulder,elbow,hand],3);
      if(p.arm===1 || p.arm===2) {
        line(arms,[hand[0],hand[1]-2],[hand[0],hand[1]+2],2,'S');
        line(arms,[hand[0]-1,hand[1]-2],[hand[0]-1,hand[1]+1],1,'s');
      } else {line(arms,hand,hand,3,'S');line(arms,[hand[0]-1,hand[1]-1],[hand[0]-1,hand[1]-1],2,'s');}
      const other=side?[[28+dx+torsoLean,25+dy],[34+dx,33+dy],[40+dx,29+dy]]:[[19,25+dy],[19,33+dy],[29,30+dy]];
      limb(arms,other,2);line(arms,other[2],other[2],2,'s');
      if(up) {
        const body=blank();stamp(body,arms);stamp(body,g);stamp(g,body);
      } else stamp(g,arms);
      const layers=[`${view}_shadow`,save(`combat_${view}_takedown_${p.name}`,g)];
      if(p.active) layers.push(save(`hit_${view}_takedown_${p.name}`,arms));
      return entry(layers,p.duration,p.active);
    })};
  }
  fs.writeFileSync(path.join(root,'sprite.json'),JSON.stringify(json,null,character==='mason'?2:1)+'\n');
}
