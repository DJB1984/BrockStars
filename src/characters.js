// Balance profiles from the November 18 notes. Speeds are relative to normal (140 px/s).
const profile = (name, health, punch, kick, headbutt, speedMultiplier = 1) => Object.freeze({
  name, health, punch, kick, headbutt, speedMultiplier, speed: Math.round(140 * speedMultiplier),
  kickCooldown: 5000, headbuttCooldown: 10000, blockDuration: 3000,
});

// Keep upcoming characters separate from the roster with finished game assets.
export const CHARACTER_STATS = Object.freeze({
  mason: profile('Mason', 90, 3, 7, 9, 1.1),
  titus: profile('Titus', 125, 4, 9, 10),
  james: profile('James', 200, 5, 8, 15, 0.9),
  ben: profile('Ben', 185, 6, 7, 12, 0.8),
  clayton: profile('Clayton', 115, 5, 7, 9),
  anand: profile('Anand', 135, 3, 6, 9),
  tj: profile('TJ', 100, 2, 4, 7, 1.15),
  bigred: profile('Big Red', 150, 5, 8, 14, 0.95),
});
export const characterStats = (id) => CHARACTER_STATS[id] ?? CHARACTER_STATS.titus;
export const CHARACTERS = Object.freeze(Object.fromEntries(
  ['titus', 'mason', 'james'].map(id => [id, CHARACTER_STATS[id]]),
));
export const isCharacter = (id) => Object.hasOwn(CHARACTERS, id);
