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
// Arms are the walking sleeve's width (5px fill), lit from the top-left, with a shirt cuff at the wrist.
// The first segment can end flat at the shoulder, like the idle arms. Fists are a fixed 6x5 stamp.
const SLEEVE = 5;
const FIST = ['.kkkkkk.', 'kssssssk', 'ksssssSk', 'ksssssSk', 'kSsSsSSk', '.kSSSSk.', '..kkkk..'];
function sleeve(grid, a, b, { cuff = false, flat = false } = {}) {
  const L = Math.hypot(b[0]-a[0], b[1]-a[1]) || 1, ux = (b[0]-a[0]) / L, uy = (b[1]-a[1]) / L;
  let nx = -uy, ny = ux;
  if (nx + ny > 0) { nx = -nx; ny = -ny; }   // normal toward the light
  const r = SLEEVE / 2;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const cx = x + .5, cy = y + .5, raw = (cx-a[0])*ux + (cy-a[1])*uy;
    if (flat && raw < 0) continue;
    const t = Math.max(0, Math.min(L, raw)), qx = a[0] + ux*t, qy = a[1] + uy*t;
    if (Math.hypot(cx-qx, cy-qy) > r) continue;
    const s = (cx-qx)*nx + (cy-qy)*ny;
    let k = s > r - 1.2 ? 'g' : s < -(r - 1.2) ? 'd' : 'm';
    if (cuff && t > L - 1.5 && k === 'm') k = 'w';
    grid[y][x] = k;
  }
}
function outline(grid) {
  const fill = grid.map(r => r.map(c => c !== '.'));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (!fill[y][x] && [[1,0],[-1,0],[0,1],[0,-1]].some(([u,v]) => fill[y+v]?.[x+u])) grid[y][x] = 'k';
  }
}
function stamp(grid, rows, x0, y0) {
  rows.forEach((row, j) => [...row].forEach((c, i) => { if (c !== '.' && grid[y0+j]?.[x0+i] !== undefined) grid[y0+j][x0+i] = c; }));
}
const stampFist = (grid, x, y) => stamp(grid, FIST, x-2, y-3);
// points: shoulder, (elbow...), wrist. `hand` stamps the fist into the same layer.
function arm(name, points, { flat = false, cuff = true, hand = null } = {}) {
  const g = blank();
  for (let i = 1; i < points.length; i++) sleeve(g, points[i-1], points[i], { flat: flat && i === 1, cuff: cuff && i === points.length-1 });
  outline(g);
  if (hand) stampFist(g, ...hand);
  return save(name, g);
}
function fist(name, x, y) { const g = blank(); stampFist(g, x, y); return save(name, g); }
// Speed lines trailing a punch, as [x0, y0, x1, y1] runs of light gray.
function streak(name, runs) {
  const g = blank();
  for (const [x0, y0, x1, y1] of runs) line(g, [x0, y0], [x1, y1], 0, 'w');
  return save(name, g);
}
const entry = (layers, duration, active=false) => ({ layers, duration, ...(active ? { active:true } : {}) });
for (const [facing, view] of [['down','front'], ['up','back'], ['side','side']]) {
  const side = view === 'side', up = view === 'back';
  const base = [ `${view}_shadow`, `${view}_legs_stand`, `${view}_torso` ];
  const head = `${view}_head`;
  // Each arm pose: sleeve points (shoulder, elbow..., wrist), options, and the fist's anchor.
  // The side view's far arm is hidden by the body; front and back hold it up in a guard.
  const A = side ? {
    other: null,
    guard: [[[30.5,23],[32.5,28.5],[39.5,22]], {}, [39,19]],
    chamber: [[[30.5,23],[31.5,29],[36,23.5]], {}, [35,20]],   // wind-up: fist pulled back, elbow cocked
    strike: [[[31,24],[46,24]], {}, [47,24]],
    mid: [[[30.5,23],[34,28.5],[41,25]], {}, [42,24]],
    streak: [[37,19,44,19],[35,29,44,29]],
  } : {
    other: [[[19.5,21],[20,30]], { flat:true, cuff:false }, [22,28]],
    guard: [[[44.5,21],[43.5,29.5],[40.5,26]], { flat:true }, [38,24]],
    chamber: [[[44.5,21],[46.5,28],[45,25]], { flat:true }, [43,23]],
    strike: up ? [[[44.5,25],[43,14]], { flat:true }, [42,11]] : [[[44.5,21],[40,35]], { flat:true }, [37,38]],
    mid: up ? [[[44.5,25],[43.5,20]], { flat:true }, [42,18]] : [[[44.5,21],[43.5,29],[42.5,31]], { flat:true }, [41,32]],
    streak: up ? [[48,14,48,23],[50,17,50,22]] : [[49,24,46,33],[51,28,49,34]],
  };
  // The left-hand punch (front and back only) mirrors every pose across the body's centre line
  // and redraws it, so it stays lit from the top-left instead of being a flipped copy.
  const mirror = m => ({
    pts: pts => m ? pts.map(([x, y]) => [64 - x, y]) : pts,
    hand: ([x, y]) => m ? [60 - x, y] : [x, y],
    runs: runs => m ? runs.map(([x0, y0, x1, y1]) => [63 - x0, y0, 63 - x1, y1]) : runs,
  });
  const armSet = (tag, m) => {
    const M = mirror(m), n = part => `combat_${view}_${tag}${part}`;
    const limbOf = (name, [pts, opts]) => arm(name, M.pts(pts), opts);
    const fistOf = (name, spec) => fist(name, ...M.hand(spec[2]));
    // The idle arm is the other one: mirrored, it's the regular set's guard arm on the left.
    const other = !A.other ? save(n('other_arm'), blank())
      : arm(n('other_arm'), mirror(m).pts(A.other[0]), { ...A.other[1], hand: M.hand(A.other[2]) });
    return {
      other,
      guard: limbOf(n('guard_arm'), A.guard), guardFist: fistOf(n('guard_fist'), A.guard),
      chamber: limbOf(n('chamber_arm'), A.chamber), chamberFist: fistOf(n('chamber_fist'), A.chamber),
      strike: limbOf(n('punch_arm'), A.strike), strikeFist: fistOf(`hit_${view}_${tag}punch`, A.strike),
      speed: streak(`fx_${view}_${tag}punch_streak`, M.runs(A.streak)),
      mid: limbOf(n('return_arm'), A.mid), midFist: fistOf(n('return_fist'), A.mid),
    };
  };
  const R = armSet('', false);
  const guardOther = R.other, guard = R.guard, guardFist = R.guardFist;
  // The upper body leans with the punch: back on the wind-up, into the strike. The feet stay planted.
  const pose = (a, f, offset = [0,0], fx = null, other = guardOther) => {
    const upper = up ? [other, ...(fx ? [fx] : []), a, f, base[2], head] : [base[2], other, head, ...(fx ? [fx] : []), a, f];
    return [base[0], base[1], offset[0] || offset[1] ? { from: { layers: upper }, offset } : { layers: upper }];
  };
  const back = side ? [-1,0] : up ? [0,1] : [0,-1], into = side ? [1,0] : up ? [0,-1] : [0,1];
  const punch = ATTACKS.punch.frames, snap = Math.round(punch[1] * 4 / 9);
  const punchAnim = S => ({ loop:false, frames:[
    entry(pose(S.chamber,S.chamberFist,back,null,S.other),punch[0]),
    entry(pose(S.strike,S.strikeFist,into,S.speed,S.other),snap,true),
    entry(pose(S.strike,S.strikeFist,into,null,S.other),punch[1]-snap,true),
    entry(pose(S.mid,S.midFist,[0,0],null,S.other),punch[2]),
    entry(pose(S.guard,S.guardFist,[0,0],null,S.other),punch[3])] });
  json.animations[`punch_${facing}`] = punchAnim(R);
  // TitusCombat alternates punch_<dir> and punch_alt_<dir> facing up and down.
  if (!side) json.animations[`punch_alt_${facing}`] = punchAnim(armSet('alt_', true));
  json.animations[`block_${facing}`] = { loop:true, frames:[entry(pose(guard,guardFist),300)] };

  // Keep one planted leg and animate the other from a lifted knee into an extended kick.
  const legs = read(`${view}_legs_stand`);
  for (let y=0; y<64; y++) for (let x=0; x<64; x++) if (!side && x>=32) legs[y][x]='.';
  const support = save(`combat_${view}_support_leg`,legs);
  // The kicking leg is the standing leg's width (5px fill) and its shoe is the standing shoe.
  const hip = side ? [31.5,37] : up ? [35.5,37] : [35.5,34];
  const raisedPath = side ? [hip,[38.5,33.5],[39,41]] : up ? [hip,[36,32],[36.5,38]] : [hip,[37,41],[37.5,45]];
  const kickPath = side ? [hip,[46,34]] : up ? [hip,[42,36],[50,32]] : [hip,[39,52]];
  const leg = (name, points) => arm(name, points, { flat: !side, cuff: false });
  const raisedName = leg(`combat_${view}_raised_leg`, raisedPath), kickName = leg(`combat_${view}_kick_leg`, kickPath);
  const shoe = (name, rows, x, y) => { const g = blank(); stamp(g, rows, x, y); return save(name, g); };
  const SIDE_SHOE = ['kDnnnnnk', 'knnnnnnk', '.kkkkkk.'];
  const TOE_SHOE = ['.kkkkkk..', 'kDDnnnnk.', 'knnnnnnnk', 'knnnnnnnk', '.kkkkkkk.'];
  const FRONT_SHOE = ['.kkkkk.', 'kDnnnnk', 'knnnnnk', 'knnnnnk', '.kkkkk.'];
  const raisedShoe = side ? shoe(`combat_${view}_raised_shoe`, SIDE_SHOE, 36, 42)
    : shoe(`combat_${view}_raised_shoe`, FRONT_SHOE, up ? 33 : 34, up ? 38 : 45);
  const hitShoe = side ? shoe(`hit_${view}_kick`, TOE_SHOE, 44, 31)
    : up ? shoe(`hit_${view}_kick`, FRONT_SHOE, 48, 28) : shoe(`hit_${view}_kick`, FRONT_SHOE, 36, 52);
  // The side kick leans the upper body back to balance the extended leg.
  const kickPose = (legLayer, foot, offset = [0,0]) => {
    const upper = up ? [guardOther, guard, guardFist, `${view}_torso`, head] : [`${view}_torso`, guardOther, head, guard, guardFist];
    const body = offset[0] || offset[1] ? { from: { layers: upper }, offset } : { layers: upper };
    return up ? [`${view}_shadow`, support, legLayer, foot, body] : [`${view}_shadow`, support, body, legLayer, foot];
  };
  const kick=ATTACKS.kick.frames;
  json.animations[`kick_${facing}`]={loop:false,frames:[entry(kickPose(raisedName,raisedShoe),kick[0]),entry(kickPose(kickName,hitShoe,side?[-1,0]:[0,0]),kick[1],true),entry(kickPose(raisedName,raisedShoe),kick[2]),entry(pose(guard,guardFist),kick[3])]};

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
json.roles = { 'hit_*':'hit', 'fx_*':'none', ...json.roles };
json.hit_pad = 1;
fs.writeFileSync(path.join(root,'sprite.json'), JSON.stringify(json,null,1)+'\n');
