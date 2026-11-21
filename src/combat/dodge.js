// What a dodge looks like: a few fading afterimages left along the hop, tinted cool so they read as motion and
// not as more fighters. The local fighter's dodge (TitusCombat.js) and an online player's (remotes.js) both use it.
//   dodgeTrail(scene, sprite, 160);   // for the dodge's duration in ms
const EVERY = 40, FADE = 220, TINT = 0x9ad8ff;

export function dodgeTrail(scene, sprite, duration) {
  const ghost = () => {
    if (!sprite.active || !sprite.visible || !sprite.frame) return;
    const g = scene.add.image(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)
      .setOrigin(sprite.originX, sprite.originY).setFlipX(sprite.flipX).setDepth(sprite.depth - 0.1)
      .setTint(TINT).setAlpha(0.55).setBlendMode('ADD');
    scene.tweens.add({ targets: g, alpha: 0, duration: FADE, onComplete: () => g.destroy() });
  };
  ghost();
  for (let t = EVERY; t < duration; t += EVERY) scene.time.delayedCall(t, ghost);
}
