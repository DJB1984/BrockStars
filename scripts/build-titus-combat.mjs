// Author Titus's combat layers as Pixel Forge text grids, reusing his existing head, suit and palette.
import fs from 'node:fs';
import path from 'node:path';
import { ATTACKS } from '../src/combat/rules.js';
const root = path.resolve('sprites/titus'), dir = path.join(root, 'frames');
const json = JSON.parse(fs.readFileSync(path.join(root, 'sprite.json'), 'utf8'));
const blank = () => Array.from({ length: 64 }, () => Array(64).fill('.'));
const read = name => fs.readFileSync(path.join(dir, `${name}.txt`), 'utf8').trimEnd().split(/\r?\n/).map(r => [...r]);
const save = (name, grid) => { fs.writeFileSync(path.join(dir, `${name}.txt`), grid.map(r => r.join('')).join('\n') + '\n'); return name; };
function line(grid, a, b, width, color) {
  const steps = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a[0] + (b[0] - a[0]) * i / steps), y = Math.round(a[1] + (b[1] - a[1]) * i / steps);
    for (let v = -width; v <= width; v++) for (let u = -width; u <= width; u++) {
      if (u*u + v*v <= width*width + 1 && grid[y+v]?.[x+u] !== undefined) grid[y+v][x+u] = color;
    }
  }
}
function limb(grid, points, wide = 3, mid = 'm', light = 'g') {
  for (let i = 1; i < points.length; i++) line(grid, points[i-1], points[i], wide+1, 'k');
  for (let i = 1; i < points.length; i++) line(grid, points[i-1], points[i], wide, 'd');
  for (let i = 1; i < points.length; i++) line(grid, points[i-1].map(v => v-1), points[i].map(v => v-1), Math.max(1,wide-1), mid);
  for (let i = 1; i < points.length; i++) line(grid, [points[i-1][0]-wide+1,points[i-1][1]-1], [points[i][0]-wide+1,points[i][1]-1], 0, light);
}
function fist(name, x, y) {
  const g = blank();
  line(g, [x,y], [x+1,y], 4, 'k');
  line(g, [x,y], [x+1,y], 3, 'S');
  line(g, [x-1,y-1], [x+1,y-1], 2, 's');
  return save(name,g);
}
function arm(name, points) { const g=blank(); limb(g,points); return save(name,g); }
const entry = (layers, duration, active=false) => ({ layers, duration, ...(active ? { active:true } : {}) });
for (const [facing, view] of [['down','front'], ['up','back'], ['side','side']]) {
  const side = view === 'side', up = view === 'back';
  const base = [ `${view}_shadow`, `${view}_legs_stand`, `${view}_torso` ];
  const head = `${view}_head`;
  const shoulder = side ? [31,24] : [43,24];
  const guardElbow = side ? [39,29] : [45,30];
  const guardHand = side ? [40,20] : [39,23];
  const hitHand = side ? [51,27] : up ? [43,13] : [43,42];
  const midHand = side ? [46,25] : up ? [42,19] : [42,33];
  const other = blank();
  if (!side) { limb(other,[[19,24],[18,31],[23,27]]); line(other,[23,27],[23,27],3,'S'); line(other,[22,26],[22,26],2,'s'); }
  const guardOther = save(`combat_${view}_other_arm`,other);
  const guard = arm(`combat_${view}_guard_arm`,[shoulder,guardElbow,guardHand]);
  const guardFist = fist(`combat_${view}_guard_fist`,...guardHand);
  const strike = arm(`combat_${view}_punch_arm`,[shoulder,side?[40,26]:up?[43,20]:[44,33],hitHand]);
  const strikeFist = fist(`hit_${view}_punch`,...hitHand);
  const mid = arm(`combat_${view}_return_arm`,[shoulder,guardElbow,midHand]);
  const midFist = fist(`combat_${view}_return_fist`,...midHand);
  const pose = (a, f) => up ? [base[0],base[1],guardOther,a,f,base[2],head] : [...base,guardOther,head,a,f];
  const punch = ATTACKS.punch.frames;
  json.animations[`punch_${facing}`] = { loop:false, frames:[entry(pose(guard,guardFist),punch[0]),entry(pose(strike,strikeFist),punch[1],true),entry(pose(mid,midFist),punch[2]),entry(pose(guard,guardFist),punch[3])] };
  json.animations[`block_${facing}`] = { loop:true, frames:[entry(pose(guard,guardFist),300)] };

  // Keep one planted leg and animate the other from a lifted knee into an extended kick.
  const legs = read(`${view}_legs_stand`);
  for (let y=0; y<64; y++) for (let x=0; x<64; x++) if (!side && x>=32) legs[y][x]='.';
  const support = save(`combat_${view}_support_leg`,legs);
  const hip = side ? [32,37] : [37,37];
  const knee = side ? [39,34] : up ? [37,32] : [39,41];
  const raised = side ? [39,41] : up ? [37,38] : [40,45];
  const toe = side ? [55,36] : up ? [44,25] : [40,57];
  const kickLeg = blank(); limb(kickLeg,[hip,knee,toe],3,'m','g');
  const raisedLeg = blank(); limb(raisedLeg,[hip,knee,raised],3,'m','g');
  const kickName = save(`combat_${view}_kick_leg`,kickLeg), raisedName=save(`combat_${view}_raised_leg`,raisedLeg);
  const shoe=(name,p) => { const g=blank(); line(g,[p[0]-1,p[1]],[p[0]+3,p[1]],3,'k'); line(g,[p[0]-1,p[1]],[p[0]+3,p[1]],2,'n'); line(g,[p[0]-2,p[1]-2],[p[0]+2,p[1]-2],0,'D'); return save(name,g); };
  const raisedShoe=shoe(`combat_${view}_raised_shoe`,raised),hitShoe=shoe(`hit_${view}_kick`,toe);
  const kickPose=(leg,foot) => up
    ? [`${view}_shadow`,support,leg,foot,guardOther,guard,guardFist,`${view}_torso`,head]
    : [`${view}_shadow`,support,`${view}_torso`,guardOther,head,guard,guardFist,leg,foot];
  const kick=ATTACKS.kick.frames;
  json.animations[`kick_${facing}`]={loop:false,frames:[entry(kickPose(raisedName,raisedShoe),kick[0]),entry(kickPose(kickName,hitShoe),kick[1],true),entry(kickPose(raisedName,raisedShoe),kick[2]),entry(pose(guard,guardFist),kick[3])]};

  const strikeHead=save(`hit_${view}_headbutt`,read(head));
  const neck=blank();
  if(up) { line(neck,[31,18],[31,23],3,'k'); line(neck,[31,18],[31,23],2,'S'); }
  const neckName=save(`combat_${view}_neck`,neck);
  const headPose=(offset,active=false) => up
    ? [base[0],base[1],neckName,guardOther,guard,guardFist,base[2],{from:active?strikeHead:head,offset}]
    : [...base,guardOther,{from:active?strikeHead:head,offset},guard,guardFist];
  const headbutt=ATTACKS.headbutt.frames;
  json.animations[`headbutt_${facing}`]={loop:false,frames:[entry(headPose(side?[-3,-1]:up?[0,2]:[0,-2]),headbutt[0]),entry(headPose(side?[7,3]:up?[0,-3]:[0,9],true),headbutt[1],true),entry(headPose(side?[4,2]:up?[0,-1]:[0,5]),headbutt[2]),entry(headPose([0,0]),headbutt[3])]};
}
json.roles = { 'hit_*':'hit', ...json.roles };
json.hit_pad = 1;
fs.writeFileSync(path.join(root,'sprite.json'), JSON.stringify(json,null,1)+'\n');
