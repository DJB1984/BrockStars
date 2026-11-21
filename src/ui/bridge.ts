// The in-game HUD's link to the game. Phaser (scenes/Level.js) writes the state here when something
// changes, never every frame, and the React HUD (Hud.tsx) reads it with useSyncExternalStore. Timers are
// deadlines on performance.now(), so the HUD animates cooldowns in CSS without hearing from the game again.
// The other way round, the touch controls hold buttons down in `touch`, which the combat controller reads
// next to the keyboard, and the menu calls `actions`.
import { touch as rawTouch, releaseTouch as rawRelease } from '../combat/touch.js';

export type Timed = { endsAt: number; duration: number };

// Block: ready, held up (it drops after `duration` even if the key is still down), or cooling down.
export type Shield = { phase: 'ready' } | ({ phase: 'holding' | 'cooldown' } & Timed);

// The fighter's special. `locked` until it's built (Mason's Grapple); ready when endsAt has passed.
export type Super = { name: string; key: string; locked: boolean } & Timed;

export type NetBadge = { active: boolean; world: boolean; room: string | null; count: number };

// The three basic moves' cooldowns: ready once endsAt has passed (0 = ready).
export type Basic = 'punch' | 'kick' | 'headbutt';

// A move pressed while it was still cooling down (`id` counts up, so the same move twice wiggles twice).
export type Dud = { move: Basic | 'block' | 'bellow' | 'grapple' | 'takedown'; id: number };

// Hit by someone you can't see: `angle` (radians, screen axes) from you toward them, `from` where you are on
// the screen (fractions of its width and height).
export type HitArrow = { id: number; angle: number; from: [number, number] };

export type HudState = {
  visible: boolean;            // only while a level is being played (not over the lobby or practice)
  character: string;
  shield: Shield;
  super: Super;
  moves: Record<Basic, Timed>;
  dodge: Timed;                // the dodge's short cooldown (0 = ready)
  dud: Dud | null;
  hitArrow: HitArrow | null;
  net: NetBadge;
  toast: { id: number; text: string } | null;
};

let state: HudState = {
  visible: false,
  character: 'titus',
  shield: { phase: 'ready' },
  super: { name: '', key: 'S', locked: true, endsAt: 0, duration: 1 },
  moves: { punch: { endsAt: 0, duration: 1 }, kick: { endsAt: 0, duration: 1 }, headbutt: { endsAt: 0, duration: 1 } },
  dodge: { endsAt: 0, duration: 1 },
  dud: null,
  hitArrow: null,
  net: { active: false, world: false, room: null, count: 1 },
  toast: null,
};

const listeners = new Set<() => void>();
let toasts = 0;

export const hud = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  set(patch: Partial<HudState>) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  },
  toast(text: string) {
    hud.set({ toast: { id: ++toasts, text } });
  },
};

// Held touch buttons, read by the combat controller (src/combat/TitusCombat.js) as if they were keys.
// They live in plain JS (src/combat/touch.js) so the combat code still runs under node's tests.
export type TouchButton = 'left' | 'right' | 'up' | 'down' | 'punch' | 'kick' | 'headbutt' | 'block' | 'takedown' | 'dodge';
export type Facing = 'up' | 'down' | 'left' | 'right';
// `aim`: the move being dragged and which way (null: back in the middle, cancelled); `aimed`: where the next one goes.
export type TouchInput = Record<TouchButton, boolean> & { aim: { move: TouchButton; facing: Facing | null } | null;
  aimed: { move: TouchButton; facing: Facing } | null };
export const touch = rawTouch as TouchInput;
export const releaseTouch = rawRelease as () => void;

// What the menu can ask of the level scene; it sets these when it starts.
export const actions = {
  changeFighter: () => {},
  leave: () => {},
};
