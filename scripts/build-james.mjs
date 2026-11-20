// James uses Mason's editable layer rig, walk cycle, and shared basic-attack timings.
// Run: node scripts/build-james.mjs, then pixelforge export james.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('sprites/james');
const dir = path.join(root, 'frames');
const source = path.resolve('sprites/mason');
fs.mkdirSync(dir, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(source, 'sprite.json'), 'utf8'));
spec.name = 'james';
spec.class = 'tall_topdown';
spec.palette = {
  k:'#17151c', z:'#18142555', s:'#edb38a', S:'#c98c67', a:'#f8c9a1',
  b:'#50372b', B:'#30221f', e:'#261f21',
  g:'#55545b', m:'#38383f', d:'#26262d', w:'#414148', t:'#303037', T:'#1f1f26',
  n:'#30313c', D:'#696a73', h:'#d8c2a4', H:'#f2dfbd', j:'#b49b83', J:'#8d796c',
  W:'#e6dfcd', u:'#d7631c', r:'#a64213', o:'#f18a2b', c:'#b58b50', C:'#e3ba78',
};
const blank=()=>Array.from({length:64},()=>Array(64).fill('.'));
const read=(folder,name)=>fs.readFileSync(path.join(folder,`${name}.txt`),'utf8').trimEnd().split(/\r?\n/).map(r=>[...r]);
// Keep the shared 64px rig as the authoring base, then lengthen James at the hips
// and legs into his own 64x80 canvas. His feet stay on the class origin (32,68).
const tallY=y=>y<=24?y+6:y<=40?30+(y-24)*1.25:y<=52?50+(y-40)*1.5:y+16;
const save=(name,g)=>{
  const tall=Array.from({length:80},()=>Array(64).fill('.'));
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const c=g[y][x];if(c==='.')continue;
    const left=Math.round(32+(x-32)*0.9),right=Math.round(32+(x+1-32)*0.9);
    for(let yy=Math.round(tallY(y));yy<Math.round(tallY(y+1));yy++)
      for(let xx=left;xx<right;xx++)if(tall[yy]?.[xx]!==undefined)tall[yy][xx]=c;
  }
  fs.writeFileSync(path.join(dir,`${name}.txt`),tall.map(r=>r.join('')).join('\n')+'\n');
};
const grids={};
const put=(g,x,y,color)=>{if(g[y]?.[x]!==undefined)g[y][x]=color;};
function rect(g,x,y,w,h,color){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)put(g,xx,yy,color);}
function poly(g,points,color){
  const minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
  for(let y=minY;y<=maxY;y++)for(let x=0;x<64;x++){
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const [xi,yi]=points[i],[xj,yj]=points[j];
      if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
    }
    if(inside)put(g,x,y,color);
  }
}
function ellipse(g,cx,cy,rx,ry,color){for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)put(g,x,y,color);}
function line(g,a,b,width,color){
  const steps=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]),1);
  for(let i=0;i<=steps;i++){
    const x=Math.round(a[0]+(b[0]-a[0])*i/steps),y=Math.round(a[1]+(b[1]-a[1])*i/steps);
    for(let dy=-width;dy<=width;dy++)for(let dx=-width;dx<=width;dx++)if(dx*dx+dy*dy<=width*width+1)put(g,x+dx,y+dy,color);
  }
}
function stamp(g,from,dx=0,dy=0){from.forEach((row,y)=>row.forEach((c,x)=>{if(c!=='.')put(g,x+dx,y+dy,c);}));}
// Widen the same arm swings, planted feet and combat limbs around the shared origin.
// Costume patches on Mason's sleeves become plain charcoal fabric for James.
for(const filename of fs.readdirSync(path.join(source,'frames'))){
  if(!filename.endsWith('.txt'))continue;
  const name=filename.slice(0,-4),old=read(path.join(source,'frames'),name),g=blank();
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    let c=old[y][x];if(c==='.')continue;
    if(['u','r','W'].includes(c))c='m';
    const left=Math.round(32+(x-32)*1.25),right=Math.round(32+(x+1-32)*1.25);
    for(let xx=left;xx<right;xx++)put(g,xx,y,c);
  }
  // Bare hands below ribbed hoodie cuffs, without Mason's sleeve insignia.
  if(/^(front|back)_(arms|left_arm|right_arm)/.test(name)||/^side_(arm|walk_.*arm)/.test(name)){
    for(let y=36;y<40;y++)for(let x=0;x<64;x++)if(g[y][x]!=='.'&&g[y][x]!=='k')g[y][x]=x<32?'s':'S';
  }
  // Sneakers keep the same footfall positions with pale rubber soles.
  if(name.includes('leg')||name.includes('shoe')||name.includes('kick')){
    for(let y=49;y<51;y++)for(let x=0;x<64;x++)if(g[y][x]==='n')g[y][x]='W';
  }
  grids[name]=g;
}
function frontHead(){
  const g=blank();
  ellipse(g,32,18,10,8,'k');ellipse(g,32,18,9,7,'S');ellipse(g,30,18,7,6,'s');
  rect(g,22,15,2,5,'S');rect(g,41,15,2,5,'S');
  rect(g,24,12,16,5,'B');rect(g,24,15,2,4,'b');rect(g,39,15,2,4,'b');
  rect(g,26,17,4,1,'b');rect(g,35,17,4,1,'b');
  rect(g,27,18,2,2,'e');rect(g,36,18,2,2,'e');put(g,27,18,'W');put(g,36,18,'W');
  rect(g,32,19,1,3,'S');rect(g,29,23,6,1,'b');
  poly(g,[[22,13],[22,9],[25,6],[29,4],[36,4],[40,7],[42,10],[42,14]],'k');
  poly(g,[[23,12],[24,9],[27,6],[35,5],[39,8],[41,12],[41,14]],'h');
  poly(g,[[25,10],[27,7],[30,6],[35,6],[37,10],[37,12],[25,12]],'H');
  rect(g,38,9,2,4,'j');
  // Orange Dragons D, readable at the game's native pixel scale.
  for(const [y,row]of ['uuu..','.u.u.','.u.u.','.u.u.','uuu..'].entries())for(let x=0;x<row.length;x++)if(row[x]!=='.')put(g,31+x,7+y,row[x]);
  poly(g,[[22,13],[27,12],[37,12],[43,14],[43,16],[39,17],[35,15],[27,15],[23,16],[21,15]],'k');
  poly(g,[[23,13],[28,13],[37,13],[41,14],[42,15],[39,16],[35,14],[27,14],[23,15]],'u');
  rect(g,26,13,11,1,'H');put(g,40,14,'o');
  return g;
}
function backHead(){
  const g=blank();
  ellipse(g,32,18,10,8,'k');ellipse(g,32,18,9,7,'B');rect(g,24,16,16,6,'b');rect(g,28,22,9,3,'S');
  poly(g,[[22,18],[22,10],[25,6],[29,4],[36,4],[40,7],[42,10],[42,18],[38,21],[26,21]],'k');
  poly(g,[[23,17],[24,10],[27,7],[30,5],[35,5],[39,8],[41,11],[41,17],[37,19],[27,19]],'h');
  poly(g,[[25,14],[26,9],[30,6],[34,6],[35,17],[27,18]],'H');
  rect(g,31,6,1,10,'j');rect(g,28,17,9,3,'J');rect(g,29,18,7,2,'B');rect(g,29,19,7,1,'h');
  return g;
}
function sideHead(){
  const g=blank();
  poly(g,[[25,13],[36,12],[40,15],[41,19],[44,20],[41,22],[39,25],[31,26],[27,23],[25,18]],'k');
  poly(g,[[27,14],[36,14],[39,16],[39,20],[42,20],[39,22],[38,24],[31,24],[28,21]],'S');
  poly(g,[[30,15],[36,15],[38,17],[38,20],[40,20],[38,21],[37,23],[32,23]],'s');
  rect(g,26,14,6,7,'B');rect(g,27,16,3,4,'b');rect(g,30,18,2,3,'s');put(g,30,19,'S');
  rect(g,36,17,3,1,'b');rect(g,37,18,2,2,'e');rect(g,37,23,2,1,'b');
  poly(g,[[24,15],[24,10],[27,6],[31,4],[37,5],[40,8],[41,12],[41,15]],'k');
  poly(g,[[25,14],[25,10],[28,7],[32,5],[36,6],[39,9],[40,14]],'h');
  poly(g,[[27,13],[27,9],[30,6],[34,6],[35,13]],'H');rect(g,35,8,1,6,'j');
  rect(g,38,9,2,4,'u');put(g,40,10,'r');put(g,40,11,'r');
  poly(g,[[35,13],[42,13],[46,15],[46,17],[40,18],[35,16],[25,16],[25,14]],'k');
  poly(g,[[35,14],[42,14],[45,15],[44,16],[40,17],[35,15],[26,15],[26,14]],'u');rect(g,36,14,7,1,'H');
  return g;
}
function torso(view){
  const g=blank(),side=view==='side',back=view==='back';
  if(side){
    poly(g,[[27,23],[37,23],[42,27],[44,33],[44,38],[40,41],[24,41],[21,37],[21,29],[24,25]],'k');
    poly(g,[[27,24],[37,24],[40,28],[42,33],[42,38],[38,40],[25,40],[23,36],[23,29]],'m');
    poly(g,[[23,28],[27,25],[30,27],[28,37],[25,38],[23,35]],'w');
    poly(g,[[27,23],[35,23],[38,26],[34,29],[28,28],[24,26]],'d');
    line(g,[28,24],[32,26],0,'g');rect(g,37,28,1,5,'W');rect(g,37,32,1,1,'j');
    line(g,[35,34],[40,34],0,'d');rect(g,35,35,6,3,'t');line(g,[35,35],[34,37],0,'g');
    rect(g,25,39,16,1,'d');
  }else{
    poly(g,[[24,23],[39,23],[45,26],[46,31],[46,36],[43,41],[21,41],[18,36],[18,30],[20,26]],'k');
    poly(g,[[24,24],[39,24],[43,27],[44,31],[44,36],[41,40],[23,40],[20,36],[20,30],[22,27]],'m');
    poly(g,[[22,28],[25,25],[28,27],[25,32],[25,37],[22,36],[21,32]],'w');
    poly(g,[[40,27],[43,30],[43,36],[40,39],[38,38],[40,33]],'d');
    if(back){
      poly(g,[[24,24],[39,24],[41,27],[38,30],[26,30],[22,27]],'d');
      line(g,[25,26],[28,29],0,'g');line(g,[28,29],[36,29],0,'w');line(g,[32,32],[32,37],0,'t');
    }else{
      poly(g,[[24,23],[29,25],[35,25],[39,23],[41,26],[36,29],[28,29],[22,26]],'d');
      line(g,[24,25],[29,28],0,'g');line(g,[29,28],[35,28],0,'w');
      rect(g,27,28,1,5,'W');rect(g,36,28,1,5,'W');put(g,27,33,'j');put(g,36,33,'j');
      poly(g,[[27,34],[37,34],[40,37],[38,39],[26,39],[24,37]],'t');
      line(g,[27,34],[37,34],0,'g');line(g,[26,35],[24,37],0,'d');line(g,[38,35],[40,37],0,'d');
      // Small Carhartt workwear label on the kangaroo pocket.
      rect(g,36,36,3,3,'c');rect(g,37,36,2,2,'C');put(g,38,37,'c');
    }
    rect(g,24,39,16,1,'d');
  }
  return g;
}
for(const [view,head]of [['front',frontHead()],['back',backHead()],['side',sideHead()]]){
  grids[`${view}_head`]=head;
  grids[`hit_${view}_headbutt`]=head;
  grids[`${view}_torso`]=torso(view);
  // Broad, soft sleeves match the hoodie instead of leaving straight uniform arms.
  for(const name of Object.keys(grids).filter(n=>n.startsWith(`${view}_`)&&(/arms/.test(n)||n===`${view}_arm`||/walk_.*arm/.test(n)))){
    const g=grids[name];
    for(let y=25;y<35;y++)for(let x=1;x<63;x++)if(g[y][x]==='k'&&g[y][x-1]==='.'&&x<32)put(g,x-1,y,'k');
  }
}
// Rounded hoodie sleeves follow the same alternating arms and body bob as the base rig.
function sleeve(g, shoulder, elbow, hand, far=false) {
  line(g,shoulder,elbow,4,'k'); line(g,elbow,[hand[0],hand[1]-2],3,'k');
  line(g,shoulder,elbow,3,far?'d':'m'); line(g,elbow,[hand[0],hand[1]-3],2,far?'d':'m');
  line(g,[shoulder[0]-1,shoulder[1]],[elbow[0]-1,elbow[1]-1],1,far?'t':'w');
  line(g,[hand[0]-2,hand[1]-2],[hand[0]+1,hand[1]-2],0,'d');
  line(g,hand,[hand[0]+1,hand[1]],2,'k');
  line(g,hand,[hand[0]+1,hand[1]],1,far?'S':'s');
}
for(const view of ['front','back'])for(const [suffix,dy]of [['',0],['_a',-1],['_b',1]]){
  const g=blank();
  sleeve(g,[22,27],[18,32],[19,38+dy]);
  sleeve(g,[42,27],[46,32],[45,38-dy],true);
  grids[view+'_arms'+suffix]=g;
}
for(const [name,hand]of [['side_arm',[35,38]],['side_walk_arm_mid',[35,38]],['side_walk_arm_fwd',[42,35]],['side_walk_arm_back',[26,38]]]){
  const g=blank();sleeve(g,[32,27],[hand[0]-1,32],hand);grids[name]=g;
}
for(const [name,hand]of [['side_walk_farm_fwd',[40,35]],['side_walk_farm_back',[25,38]]]){
  const g=blank();sleeve(g,[30,27],[hand[0]-1,32],hand,true);grids[name]=g;
}

// James fights bare handed; Mason's source rig wears dark gloves.
for(const name of Object.keys(grids)){
  if(name.endsWith('_fist')||/^hit_.*_punch$/.test(name)){
    grids[name]=grids[name].map(row=>row.map(c=>c==='m'?'s':c==='d'?'S':c==='g'?'a':c));
  }
  if(/^hit_.*_kick$/.test(name)||name.endsWith('_raised_shoe')){
    const g=grids[name],bottom=Math.max(...g.map((row,y)=>row.some(c=>c!=='.')?y:0));
    for(let y=bottom-2;y<bottom;y++)for(let x=0;x<64;x++)if(g[y][x]==='n')g[y][x]='W';
  }
}
// Give James substantial thighs and calves, preserving the front/back inner gap.
// Grow each front/back leg toward its outside edge; keep the shared footfall timing.
for(const [name,g]of Object.entries(grids)){
  const frontBack=/^(front|back)_legs/.test(name);
  const side=/^side_(legs|walk_legs|leg_)/.test(name);
  if(!frontBack&&!side)continue;
  for(let y=36;y<64;y++){
    const original=[...g[y]],runs=[];
    for(let x=0;x<64;x++)if(original[x]!=='.'){
      const start=x;while(x+1<64&&original[x+1]!=='.')x++;runs.push([start,x]);
    }
    for(const [start,end]of runs){
      const fillLeft=original.slice(start,end+1).find(c=>c!=='k')??'m';
      const fillRight=original.slice(start,end+1).reverse().find(c=>c!=='k')??'d';
      const left=side?1:end<32?2:0,right=side?1:start>=32?2:0;
      if(left){for(let x=start-left;x<=start;x++)put(g,x,y,x===start-left?'k':fillLeft);}
      if(right){for(let x=end;x<=end+right;x++)put(g,x,y,x===end+right?'k':fillRight);}
    }
  }
}

// Match the incoming-takedown fall/get-up rig, with James's own cap and hoodie.
for(const [facing,view]of [['down','front'],['up','back'],['side','side']]){
  const standing=blank();
  for(const part of ['legs_stand','torso',view==='side'?'arm':'arms','head'])stamp(standing,grids[`${view}_${part}`]);
  for(const [amount,label]of [[0.4,'lean'],[0.9,'collapse']]){
    const g=blank();
    if(facing==='side'){
      const a=-amount*Math.PI/2,co=Math.cos(a),si=Math.sin(a);
      for(let y=0;y<64;y++)for(let x=0;x<64;x++)g[y][x]=standing[Math.round(-si*(x-32)+co*(y-32)+32)]?.[Math.round(co*(x-32)+si*(y-32)+32)]??'.';
    }else standing.forEach((row,y)=>row.forEach((c,x)=>{if(c!=='.')put(g,x,Math.round(50-(50-y)*(1-amount*0.55)+(facing==='up'?(50-y)*amount*0.25:0)),c);}));
    grids[`combat_${view}_takedown_fall_${label}`]=g;
  }
}
const lying=blank();
line(lying,[24,16],[26,27],4,'n');line(lying,[40,16],[38,27],4,'n');
line(lying,[22,13],[27,13],3,'k');line(lying,[37,13],[43,13],3,'k');
line(lying,[22,12],[27,12],1,'W');line(lying,[37,12],[43,12],1,'W');
ellipse(lying,32,32,14,10,'k');ellipse(lying,32,32,13,9,'m');
line(lying,[22,29],[17,37],3,'d');line(lying,[42,29],[47,37],3,'d');
line(lying,[17,38],[17,39],2,'s');line(lying,[47,38],[47,39],2,'S');
const head=grids.front_head;
head.forEach((row,y)=>row.forEach((c,x)=>{if(c!=='.')put(lying,63-x,56-y,c);}));
const rotate=(g,n)=>{for(let i=0;i<n;i++)g=Array.from({length:64},(_,y)=>Array.from({length:64},(_,x)=>g[63-x][y]));return g;};
grids.takedown_on_back=lying;
grids.takedown_on_back_down=rotate(lying,2);
grids.takedown_on_back_side=rotate(lying,1);
// Only emit layers referenced by James's animations, including nested composites.
const used=new Set();
function refs(entry){if(typeof entry==='string')used.add(entry);else{if(entry.from)refs(entry.from);for(const layer of entry.layers??[])refs(layer);}}
for(const a of Object.values(spec.animations))for(const entry of a.frames)refs(entry);
for(const name of used){if(!grids[name])throw new Error(`Missing James layer: ${name}`);save(name,grids[name]);}
fs.writeFileSync(path.join(root,'sprite.json'),JSON.stringify(spec,null,2)+'\n');
console.log(`James: ${used.size} editable layers, ${Object.keys(spec.animations).length} animations.`);

