// The keyboard layouts, picked in the menu's Controls and remembered on this device. The combat controller
// (combat/TitusCombat.js) reads keys through the current one, and the HUD (ui/Hud.tsx) labels its keycaps from it.
//   arrows: arrows to move, C X Z V for Punch, Kick, Headbutt and Block, S for the Super, Shift to dodge
//   wasd:   WASD to move (the arrows too), J K L I for the same four, U for the Super, Space to dodge
// Key names are Phaser's (Phaser.Input.Keyboard.KeyCodes).
export const LAYOUTS = Object.freeze({
  arrows: { name: 'Arrows', move: { left: ['LEFT'], right: ['RIGHT'], up: ['UP'], down: ['DOWN'] },
    punch: 'C', kick: 'X', headbutt: 'Z', block: 'V', super: 'S', dodge: 'SHIFT' },
  wasd: { name: 'WASD', move: { left: ['A', 'LEFT'], right: ['D', 'RIGHT'], up: ['W', 'UP'], down: ['S', 'DOWN'] },
    punch: 'J', kick: 'K', headbutt: 'L', block: 'I', super: 'U', dodge: 'SPACE' },
});
const STORE = 'brockstars.keys';
const listeners = new Set();
let current = (() => { try { return LAYOUTS[localStorage.getItem(STORE)] ? localStorage.getItem(STORE) : 'arrows'; } catch { return 'arrows'; } })();

export const layoutId = () => current;
export const layout = () => LAYOUTS[current];
export function setLayout(id) {
  if (!LAYOUTS[id] || id === current) return;
  current = id;
  try { localStorage.setItem(STORE, id); } catch { /* private window: this visit only */ }
  for (const fn of listeners) fn();
}
export function onLayout(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// Every key either layout uses, for Phaser's addKeys.
export const ALL_KEYS = [...new Set(Object.values(LAYOUTS).flatMap(l => [...Object.values(l.move).flat(), l.punch, l.kick, l.headbutt, l.block, l.super, l.dodge]))];

// How a key reads on a keycap.
export const keyLabel = (key) => ({ SHIFT: 'Shift', SPACE: 'Space' })[key] ?? key;
