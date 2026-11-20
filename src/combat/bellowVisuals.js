import { ATTACKS } from './rules.js';

// Rings live on the floor; orbiting sparks mark the full movement/healing stun.
export function updateBellowVisuals(scene, sprite, attack, stunRemaining) {
  const shouting = attack?.name === 'bellow';
  if (!sprite.bellowVisual && !shouting && !stunRemaining) return;
  let v = sprite.bellowVisual;
  if (!v) {
    v = sprite.bellowVisual = { wave:scene.add.graphics(), stars:scene.add.graphics() };
    sprite.once('destroy', () => { v.wave.destroy(); v.stars.destroy(); });
  }
  v.wave.clear().setVisible(sprite.visible).setDepth(sprite.y - 2);
  v.stars.clear().setVisible(sprite.visible).setDepth(sprite.y + 100);
  const elapsed = shouting ? scene.time.now - attack.start : -1;
  const age = elapsed - ATTACKS.bellow.frames[0];
  if (!shouting || age < 0) v.origin = null;
  if (shouting && age >= 0 && age < 500) {
    v.origin ??= {x:sprite.x, y:sprite.y};
    for (const lag of [0, 100, 200]) {
      const progress = (age-lag)/500;
      if (progress < 0 || progress > 1) continue;
      v.wave.lineStyle(2, lag === 0 ? 0xffe6a3 : 0xf0a040, (1-progress)*0.8)
        .strokeCircle(v.origin.x, v.origin.y, Math.max(3,progress*ATTACKS.bellow.reach));
    }
  }
  if (stunRemaining > 0) {
    const data = scene.cache.json.get(sprite.texture.key)?.frames?.[sprite.frame.name];
    const head = Math.min(...(data?.pixelforge?.hurt ?? [[0,6]]).map(box => box[1]));
    const top = sprite.y - sprite.displayHeight*sprite.originY + head*sprite.scaleY - 3;
    for (let i=0;i<3;i++) {
      const angle=scene.time.now/260+i*Math.PI*2/3;
      const x=sprite.x+Math.cos(angle)*11, y=top+Math.sin(angle)*3;
      v.stars.fillStyle(0xf0bb7e).fillRect(Math.round(x)-2,Math.round(y)-1,5,3)
        .fillRect(Math.round(x)-1,Math.round(y)-2,3,5);
    }
  }
}
