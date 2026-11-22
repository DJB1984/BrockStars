// The game's sounds, synthesized on the spot with the Web Audio context Phaser already unlocked (the first
// tap or key press), so nothing has to be loaded. Each one is a few milliseconds of oscillators and noise,
// played through Phaser's master mute and volume (scene.sound.destination), so the menu's Volume and Mute
// reach every one of them.
//   hitSound(scene, move, level)        the hit itself: a thwack (punch), a thud (kick), a crunch (headbutt);
//                                       the Supers land with their own heavier version
//   whoosh(scene, move, level, elapsed) the swing, from the start of the wind-up to the end of the strike
//   clank(scene, level)                 a blocked hit: metal on metal
//   koSting(scene, level)               a KO: a short falling sting over a boom
//   parryTing(scene, level)             a bright two-note ting: a perfect block
//   dudClick(scene)                     a soft, low click: a move pressed while it's still cooling down
// `level` (0..1) is how loud the sound is where this player stands: audibility() below. Every sound varies
// its pitch by up to PITCH each time, so thirty punches don't sound like one punch on a loop.
import { ATTACKS } from './combat/rules.js';

export const PITCH = 0.08;

// How far a fight is heard (world px from this player): full volume within `near`, fading to nothing at `far`.
export const HEAR = Object.freeze({ near: 80, far: 420 });

// How loud a sound at (x, y) is for a player at (px, py): 1 when it involves them (their own hit, a hit they
// take), else fading with distance, and 0 when `seen` is false: it happened in a room they can't see into,
// behind its walls, so it's muted, as the room's fighters are hidden.
export function audibility({ mine = false, seen = true, distance = 0 } = {}) {
  if (mine) return 1;
  if (!seen) return 0;
  if (distance <= HEAR.near) return 1;
  if (distance >= HEAR.far) return 0;
  const t = 1 - (distance - HEAR.near) / (HEAR.far - HEAR.near);
  return t * t;   // ears hear loudness logarithmically: a squared fade sounds even
}

// The same for a sprite in this scene: the distance from this player (or the camera's centre) and the
// rooms (roomShadows.js) say how loud it is.
export function hearing(scene, sprite, mine = false) {
  if (mine) return 1;
  if (!sprite) return 0;
  const me = scene.level?.player, view = scene.cameras?.main?.worldView;
  const [x, y] = me?.active ? [me.x, me.y] : view ? [view.centerX, view.centerY] : [sprite.x, sprite.y];
  return audibility({ seen: scene.rooms?.canSee(sprite.x, sprite.y) ?? true, distance: Math.hypot(sprite.x - x, sprite.y - y) });
}

// ---- volume and mute: the Esc menu's, remembered on this device ------------------------------------------
const STORE = 'brockstars.sound';
const listeners = new Set();
let settings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && typeof s.volume === 'number') return { volume: Math.min(1, Math.max(0, s.volume)), muted: !!s.muted };
  } catch { /* nothing saved, or a private window */ }
  return { volume: 0.8, muted: false };
})();

export const soundSettings = () => settings;
export function setSound(patch) {
  const next = { ...settings, ...patch };
  next.volume = Math.min(1, Math.max(0, Number(next.volume) || 0));
  next.muted = !!next.muted;
  if (next.volume === settings.volume && next.muted === settings.muted) return;
  settings = next;
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* private window: this visit only */ }
  for (const fn of listeners) fn();
}
export function onSound(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// Keeps Phaser's sound manager (game.sound: one for the whole game) on the menu's settings.
export function followSoundSettings(manager) {
  const apply = () => { manager.volume = settings.volume; manager.mute = settings.muted; };
  apply();
  return onSound(apply);
}

// ---- the voices -------------------------------------------------------------------------------------------

// The audio context, ready to play, and where to plug in; null when it's locked, muted or there's nothing to hear.
function out(scene, level = 1) {
  const sound = scene.sound, ctx = sound?.context;
  if (!ctx || ctx.state !== 'running' || sound.mute || level <= 0.01) return null;
  return { ctx, t: ctx.currentTime, dest: sound.destination ?? ctx.destination };
}

const pitch = () => 1 + (Math.random() * 2 - 1) * PITCH;

// A second of white noise per context, shared by every noisy sound.
const NOISE = new WeakMap();
function noise(ctx) {
  let buffer = NOISE.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    NOISE.set(ctx, buffer);
  }
  return buffer;
}

// A gain envelope: silent, up to `peak` in `attack` s, then down to silence over `decay` s.
function envelope(ctx, at, peak, attack, decay) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return gain;
}

// A tone gliding from `from` to `to` Hz over `glide` s.
function tone({ ctx, dest }, at, { type = 'sine', from, to = from, glide = 0.05, peak, attack = 0.002, decay }) {
  const osc = ctx.createOscillator(), gain = envelope(ctx, at, peak, attack, decay);
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + glide);
  osc.connect(gain).connect(dest);
  osc.start(at);
  osc.stop(at + attack + decay + 0.02);
}

// A burst of noise through a filter (`filter`: lowpass, highpass or bandpass at `freq` Hz, gliding to `to`).
function hiss({ ctx, dest }, at, { filter = 'bandpass', freq, to = freq, q = 1, peak, attack = 0.002, decay, glide = attack + decay }) {
  const src = ctx.createBufferSource(), biquad = ctx.createBiquadFilter(), gain = envelope(ctx, at, peak, attack, decay);
  src.buffer = noise(ctx);
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freq, at);
  if (to !== freq) biquad.frequency.exponentialRampToValueAtTime(to, at + glide);
  src.connect(biquad).connect(gain).connect(dest);
  src.start(at, Math.random() * 0.5);
  src.stop(at + attack + decay + 0.02);
}

// Each move's hit, at pitch `p` (1 = as written) and loudness `v`.
const HITS = {
  // a thwack: a snap of mid noise over a short knuckle thump
  punch(o, p, v) {
    hiss(o, o.t, { freq: 1900 * p, to: 900 * p, q: 1.2, peak: 0.34 * v, decay: 0.07 / p });
    tone(o, o.t, { from: 230 * p, to: 90 * p, glide: 0.06, peak: 0.32 * v, decay: 0.08 / p });
  },
  // a thud: a deep body blow, more boom than snap
  kick(o, p, v) {
    tone(o, o.t, { from: 150 * p, to: 45 * p, glide: 0.13, peak: 0.55 * v, decay: 0.16 / p });
    hiss(o, o.t, { filter: 'lowpass', freq: 900 * p, to: 200 * p, peak: 0.3 * v, decay: 0.1 / p });
  },
  // a crunch: a skull-on-skull knock with a gritty crackle running through it
  headbutt(o, p, v) {
    tone(o, o.t, { from: 120 * p, to: 38 * p, glide: 0.16, peak: 0.55 * v, decay: 0.2 / p });
    tone(o, o.t, { type: 'square', from: 300 * p, to: 70 * p, glide: 0.05, peak: 0.12 * v, decay: 0.06 / p });
    for (const [at, freq] of [[0, 1400], [0.022, 2300], [0.041, 1100], [0.063, 1800], [0.085, 900]]) {
      hiss(o, o.t + at / p, { freq: freq * p * (0.85 + Math.random() * 0.3), q: 4, peak: (0.42 - at * 2.4) * v, decay: 0.025 });
    }
  },
  // the Supers: a heavy slam, the headbutt's boom with the kick's weight
  heavy(o, p, v) {
    tone(o, o.t, { from: 110 * p, to: 32 * p, glide: 0.22, peak: 0.6 * v, decay: 0.28 / p });
    hiss(o, o.t, { filter: 'lowpass', freq: 1400 * p, to: 160 * p, peak: 0.36 * v, decay: 0.18 / p });
  },
};
const HIT_VOICE = { punch: 'punch', kick: 'kick', headbutt: 'headbutt', bellow: 'heavy', grapple: 'heavy', takedown: 'heavy' };

export function hitSound(scene, move, level = 1) {
  const o = out(scene, level), voice = HITS[HIT_VOICE[move]];
  if (o && voice) voice(o, pitch(), level);
}

// The swing: air rising through the wind-up to its peak as the strike starts, and gone by the time the
// strike ends. Heavier moves sound lower. The Bellow is a sound wave of its own: a rumble that swells
// with its wind-up. `elapsed`: how far into the attack it already is (an online player's swing shows up
// a few frames late), so it lines up with what's drawn.
export function whoosh(scene, move, level = 1, elapsed = 0) {
  const spec = ATTACKS[move], o = out(scene, level);
  if (!spec || !o) return;
  const [windup, active] = spec.frames, p = pitch();
  const rise = Math.max(0.02, (windup - elapsed) / 1000), fall = Math.max(0.04, active / 1000 + 0.03);
  if (elapsed >= windup + active) return;
  if (spec.radial) {
    tone(o, o.t, { type: 'sawtooth', from: 55 * p, to: 110 * p, glide: rise + fall, peak: 0.12 * level, attack: rise, decay: fall + 0.15 });
    hiss(o, o.t, { filter: 'lowpass', freq: 300 * p, to: 1200 * p, peak: 0.2 * level, attack: rise, decay: fall + 0.15 });
    return;
  }
  const low = { punch: 700, kick: 450, headbutt: 380 }[move] ?? 320;
  hiss(o, o.t, { freq: low * p, to: low * 3.4 * p, q: 1.6, peak: 0.16 * level, attack: rise, decay: fall });
}

// A blocked hit: two clashing metallic partials and a tick.
export function clank(scene, level = 1) {
  const o = out(scene, level);
  if (!o) return;
  const p = pitch();
  tone(o, o.t, { type: 'square', from: 620 * p, peak: 0.1 * level, decay: 0.16 });
  tone(o, o.t, { type: 'triangle', from: 1473 * p, peak: 0.16 * level, decay: 0.22 });
  tone(o, o.t, { type: 'triangle', from: 2290 * p, peak: 0.08 * level, decay: 0.12 });
  hiss(o, o.t, { filter: 'highpass', freq: 3500, peak: 0.18 * level, decay: 0.03 });
}

// A KO: three falling notes over a low boom, under half a second.
export function koSting(scene, level = 1) {
  const o = out(scene, level);
  if (!o) return;
  const p = pitch();
  tone(o, o.t, { from: 90 * p, to: 30 * p, glide: 0.35, peak: 0.45 * level, decay: 0.4 });
  for (const [at, freq] of [[0.04, 659], [0.13, 523], [0.22, 392]]) {
    tone(o, o.t + at, { type: 'square', from: freq * p, to: freq * p * 0.97, glide: 0.1, peak: 0.07 * level, decay: at === 0.22 ? 0.3 : 0.1 });
  }
}

export function parryTing(scene, level = 1) {
  const o = out(scene, level);
  if (!o) return;
  for (const [freq, at] of [[1320, 0], [1980, 0.05]]) tone(o, o.t + at, { type: 'triangle', from: freq, peak: 0.08 * level, decay: 0.18 });
}

export function dudClick(scene) {
  const o = out(scene);
  if (o) tone(o, o.t, { type: 'square', from: 190, to: 95, glide: 0.05, peak: 0.05, attack: 0.001, decay: 0.06 });
}
