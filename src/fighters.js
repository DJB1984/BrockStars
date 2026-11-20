// The playable roster: the game (Level.js) and the fighter select screen (src/ui) both read it, so what the
// stat card says is what the fighter does. Add a fighter here once its sprite is exported.
//   speed    walk speed in px/s (the world is drawn at 2x)
//   trait    the design doc's word for the speed
//   special  the design doc's special ability; `ready: false` until it's built
import { CHARACTER_STATS } from './characters.js';

export const FIGHTERS = [
  {
    id: 'mason', name: 'Mason', fullName: 'Mason Risner', trait: 'Fast',
    special: { name: 'Grapple', text: 'S: Grab one opponent in a two-second headlock for 25 damage. 20-second cooldown.', ready: true },
  },
  {
    id: 'titus', name: 'Titus', fullName: 'Titus Webster', trait: 'Normal',
    special: { name: 'Leg Sweep', text: 'Kicks their legs out and knocks them down for 30 damage.', ready: false },
  },
  {
    id: 'james', name: 'James', fullName: 'James Ricci', trait: 'Slow',
    special: { name: 'Bellow', text: 'S: A sound wave hits all opponents within 10 blocks for 10 damage, stopping movement and healing for 5 seconds. 25-second cooldown.', ready: true },
  },
].map(f => ({ ...f, ...CHARACTER_STATS[f.id] }));

export const FIGHTER_IDS = FIGHTERS.map((f) => f.id);
export const fighter = (id) => FIGHTERS.find((f) => f.id === id) ?? FIGHTERS[0];
