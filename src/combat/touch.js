// Touch buttons held down right now. The HUD's touch controls (src/ui/Hud.tsx) set them, and the combat
// controller (TitusCombat.js) reads them next to the keyboard, so a held touch button is a held key.
// A move's button can also be dragged to aim, as in Brawl Stars: `aim` is the move and facing being aimed while
// the thumb is down (fightMarks.js draws its reach on the floor; facing null = back in the middle, cancelled),
// and `aimed` the facing the next press of that move goes in, set as the thumb lets go.
export const touch = {
  left: false, right: false, up: false, down: false,
  punch: false, kick: false, headbutt: false, block: false, takedown: false, dodge: false,
  aim: null,     // { move, facing } while dragging
  aimed: null,   // { move, facing } for the press that's coming
};

export function releaseTouch() {
  for (const k of Object.keys(touch)) touch[k] = typeof touch[k] === 'boolean' ? false : null;
}
