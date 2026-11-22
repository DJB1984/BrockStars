import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAR, PITCH, audibility, hearing, hitSound, whoosh, clank, koSting, setSound, soundSettings, onSound, followSoundSettings } from '../src/sound.js';
import { HitFeel } from '../src/combat/hitFeel.js';

// A Web Audio context that only records what was asked of it: every oscillator (type, first frequency), every
// noise burst, and every gain's peak.
function fakeAudio() {
  const made = { tones: [], noises: [], peaks: [] };
  const param = (log) => ({ value: 0, setValueAtTime(v) { log?.(v); }, exponentialRampToValueAtTime(v) { log?.(v, true); } });
  const node = (extra = {}) => ({ connect(n) { return n; }, start() {}, stop() {}, ...extra });
  const ctx = {
    state: 'running', currentTime: 0, sampleRate: 8000, destination: node(),
    createOscillator() { const o = node({ type: 'sine' }); o.frequency = param((v) => { if (!o.logged) { o.logged = true; made.tones.push([o.type, v]); } }); return o; },
    createGain() { let peak = 0; const g = node(); g.gain = param((v, ramp) => { if (ramp && v > peak) { peak = v; made.peaks.push(v); } }); return g; },
    createBiquadFilter() { return node({ type: '', Q: { value: 0 }, frequency: param() }); },
    createBufferSource() { made.noises.push(1); return node(); },
    createBuffer(_, n) { const data = new Float32Array(n); return { getChannelData: () => data }; },
  };
  return { ctx, made, sound: { context: ctx, destination: node(), mute: false, volume: 1 } };
}

test('a fight you are in is always at full volume; others fade with distance and stop at walls', () => {
  assert.equal(audibility({ mine: true, distance: 9999, seen: false }), 1, 'your own hit, wherever it is');
  assert.equal(audibility({ distance: HEAR.near }), 1, 'close by: full');
  assert.equal(audibility({ distance: HEAR.far }), 0, 'far away: silent');
  const mid = audibility({ distance: (HEAR.near + HEAR.far) / 2 });
  assert.ok(mid > 0.15 && mid < 0.5, `halfway is quieter than half (${mid})`);
  assert.ok(audibility({ distance: 150 }) > audibility({ distance: 250 }), 'fades steadily');
  assert.equal(audibility({ distance: 10, seen: false }), 0, 'in a room you can\'t see into: muted');
});

test('hearing() measures from this player and asks the rooms', () => {
  const scene = { level: { player: { active: true, x: 0, y: 0 } }, rooms: { canSee: (x) => x < 500 } };
  assert.equal(hearing(scene, { x: 40, y: 0 }), 1);
  assert.equal(hearing(scene, { x: HEAR.far + 10, y: 0 }), 0);
  assert.equal(hearing(scene, { x: 600, y: 0 }, true), 1);
  assert.equal(hearing({ ...scene, rooms: { canSee: () => false } }, { x: 10, y: 0 }), 0, 'a dark room');
});

test('each move has its own hit sound, with the pitch varied each time', () => {
  const sigs = {}, random = Math.random;
  Math.random = () => 0.5;   // pitch as written
  for (const move of ['punch', 'kick', 'headbutt', 'takedown']) {
    const a = fakeAudio(); hitSound(a, move, 1);
    assert.ok(a.made.tones.length + a.made.noises.length > 0, `${move} makes a sound`);
    sigs[move] = `${a.made.tones.length}/${a.made.noises.length}/${a.made.tones[0][1]}`;
  }
  Math.random = random;
  assert.equal(new Set(Object.values(sigs)).size, 4, `four different voices (${JSON.stringify(sigs)})`);
  const firsts = new Set();
  for (let i = 0; i < 30; i++) {
    const a = fakeAudio(); hitSound(a, 'punch', 1);
    const f = a.made.tones[0][1];
    assert.ok(f >= 230 * (1 - PITCH) - 1e-9 && f <= 230 * (1 + PITCH) + 1e-9, 'within ±8%');
    firsts.add(f.toFixed(2));
  }
  assert.ok(firsts.size > 20, '30 punches don\'t sound like one on a loop');
});

test('quiet sounds are quieter, silent ones are skipped, and a locked or muted context plays nothing', () => {
  const loud = fakeAudio(), soft = fakeAudio(), none = fakeAudio(), muted = fakeAudio(), locked = fakeAudio();
  hitSound(loud, 'kick', 1); hitSound(soft, 'kick', 0.25); hitSound(none, 'kick', 0);
  assert.ok(Math.max(...soft.made.peaks) < Math.max(...loud.made.peaks) * 0.3);
  assert.equal(none.made.tones.length + none.made.noises.length, 0);
  muted.sound.mute = true; hitSound(muted, 'punch'); clank(muted); koSting(muted); whoosh(muted, 'punch');
  locked.ctx.state = 'suspended'; hitSound(locked, 'punch');
  assert.equal(muted.made.tones.length + muted.made.noises.length + locked.made.tones.length, 0);
});

test('a whoosh starts with the wind-up, lines up with a late swing, and is skipped once the strike is over', () => {
  const a = fakeAudio(); whoosh(a, 'kick', 1);
  assert.equal(a.made.noises.length, 1);
  const late = fakeAudio(); whoosh(late, 'kick', 1, 100);
  assert.equal(late.made.noises.length, 1, 'still in its wind-up');
  const over = fakeAudio(); whoosh(over, 'kick', 1, 10000);
  assert.equal(over.made.noises.length, 0);
  const bellow = fakeAudio(); whoosh(bellow, 'bellow', 1);
  assert.equal(bellow.made.tones[0][0], 'sawtooth', 'the Bellow rumbles');
});

test('HitFeel: a hit is heard as the freeze starts, a block clanks, a KO stings, a far fight is quiet', () => {
  const a = fakeAudio(), me = sprite(0), them = sprite(30), far1 = sprite(2000), far2 = sprite(2010);
  const scene = { sound: a.sound, level: { player: me }, time: { now: 0 }, events: { on() {}, once() {} },
    feel: { flash() {}, shake() {} }, cache: { json: { get: () => null } }, marks: { pop() {} } };
  const feel = new HitFeel(scene, { me: () => me });
  feel.land(me, them, 'punch', { damage: 4 });
  assert.ok(a.made.tones.length > 0 && them.hitFreeze, 'heard, and frozen, in the same call');
  a.made.tones.length = 0;
  feel.land(them, me, 'punch', { damage: 1, blocked: true });
  assert.ok(a.made.tones.some(([type, f]) => type === 'triangle' && f > 1300), 'a metallic clank');
  a.made.tones.length = 0; a.made.noises.length = 0;
  feel.land(far1, far2, 'headbutt', { damage: 10 });
  assert.equal(a.made.tones.length + a.made.noises.length, 0, 'a fight across the map is out of earshot');
  feel.land(far1, me, 'kick', { damage: 9, ko: true });
  assert.ok(a.made.tones.filter(([type]) => type === 'square').length >= 3, 'the KO sting\'s falling notes');
  a.made.noises.length = 0;
  feel.swing(me, 'punch');
  assert.equal(a.made.noises.length, 1, 'your own swing whooshes');
});

test('volume and mute: remembered, and applied to Phaser\'s sound manager', () => {
  const manager = { volume: 1, mute: false };
  const stop = followSoundSettings(manager);
  let calls = 0; const off = onSound(() => calls++);
  setSound({ volume: 0.35 });
  assert.equal(manager.volume, 0.35);
  setSound({ muted: true });
  assert.equal(manager.mute, true);
  setSound({ muted: true });
  assert.equal(calls, 2, 'no change, no update');
  setSound({ volume: 7, muted: false });
  assert.deepEqual(soundSettings(), { volume: 1, muted: false }, 'clamped');
  stop(); off();
});

function sprite(x) {
  return { active: true, x, y: 0, depth: 0, texture: { key: 'titus' }, anims: { pause() {}, resume() {} }, setPosition() {} };
}
