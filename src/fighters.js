// The playable roster: the game (Level.js) and the fighter select screen (src/ui) both read it, so what the
// stat card says is what the fighter does. Add a fighter here once its sprite is exported.
//   speed    walk speed in px/s (the world is drawn at 2x)
//   trait    the design doc's word for the speed
//   special  the design doc's special ability; `ready: false` until it's built
import { CHARACTER_STATS } from './characters.js';

export const FIGHTERS = [
  {
    id: 'mason', name: 'Mason', fullName: 'Mason Risner', trait: 'Fast',
    special: { name: 'Grapple', text: 'A slow choke hold that deals massive damage, then a long cooldown.', ready: false },
  },
  {
    id: 'titus', name: 'Titus', fullName: 'Titus Webster', trait: 'Normal',
    special: { name: 'Leg Sweep', text: 'Kicks their legs out and knocks them down for medium damage.', ready: false },
  },
  {
    id: 'james', name: 'James', fullName: 'James', trait: 'Slow',
    special: { name: 'Unassigned', text: 'Special ability coming soon.', ready: false },
  },
].map(f => ({ ...f, ...CHARACTER_STATS[f.id] }));

export const FIGHTER_IDS = FIGHTERS.map((f) => f.id);
export const fighter = (id) => FIGHTERS.find((f) => f.id === id) ?? FIGHTERS[0];
