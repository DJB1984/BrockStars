// Touch buttons held down right now. The HUD's touch controls (src/ui/Hud.tsx) set them, and the combat
// controller (TitusCombat.js) reads them next to the keyboard, so a held touch button is a held key.
export const touch = {
  left: false, right: false, up: false, down: false,
  punch: false, kick: false, headbutt: false, block: false, takedown: false, dodge: false,
};

export function releaseTouch() {
  for (const k of Object.keys(touch)) touch[k] = false;
}
