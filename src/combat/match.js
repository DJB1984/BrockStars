// What a KO means, shared by the host (net/combat.js), the screens (scenes/Level.js, net/remotes.js) and the HUD.
//   freeze: the KO hit's freeze for both fighters (ms), longer than any other hit's;
//   fadeAfter, fade: the body lies in its knockdown pose, then fades out over `fade` ms;
//   respawn: from the KO to the fighter's return at the level's spawn, the screen dimmed meanwhile;
//   safe: flashing, untouchable time on return (an attack ends it early), so nobody is spawn-camped;
//   credit: the last player to damage a fighter within this long gets the KO, even if a hazard finished it;
//   streak: KOs without falling that show the streak badge; ending one earns a bonus KO;
//   feed: how long a kill feed line stays.
export const KO = Object.freeze({ freeze: 250, fadeAfter: 600, fade: 500, respawn: 2000, safe: 1500, credit: 5000, streak: 3, feed: 4000 });

// The knockdown animation's frame where the fighter lies flat (the fall comes before it, getting up after).
export const LYING_FRAME = 4;

// Play `<char>_knockdown_<dir>` through the fall and hold it lying down.
export function holdLying(sprite) {
  const anims = sprite.anims, frames = anims?.currentAnim?.frames;
  if (!frames?.length || !anims.currentAnim.key.includes('_knockdown_')) return;
  const lying = frames[Math.min(LYING_FRAME, frames.length - 1)];
  if (frames.indexOf(anims.currentFrame) >= frames.indexOf(lying)) {
    if (anims.currentFrame !== lying) anims.setCurrentFrame(lying);
    if (anims.isPlaying) anims.pause();
  }
}

// How visible a KO'd body is `elapsed` ms after the KO: lying there, then fading out.
export const koAlpha = (elapsed) => Math.max(0, Math.min(1, 1 - (elapsed - KO.fadeAfter) / KO.fade));

// The 1.5 s of spawn safety reads as a blink.
export const safeAlpha = (now) => (Math.floor(now / 90) % 2 ? 0.35 : 1);

// A session's tally for one player.
export const newScore = () => ({ kos: 0, falls: 0, streak: 0, at: 0 });

// The leader: the most KOs (at least one); on a tie, whoever got there first keeps the crown.
export function leaderOf(scores) {
  let best = null;
  for (const [id, s] of scores) {
    if (s.kos > 0 && (!best || s.kos > best.s.kos || (s.kos === best.s.kos && s.at < best.s.at))) best = { id, s };
  }
  return best?.id ?? null;
}
