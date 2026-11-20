import { playFacing } from '../../export/pixelforge.js';

// Keep the forearm in front of the captive without hiding their head behind Mason's torso.
export function showGrappleOverlay(source, facing, holding) {
  if (!holding) { source.grappleOverlay?.setVisible(false); return; }
  let overlay = source.grappleOverlay;
  if (!overlay) {
    overlay = source.grappleOverlay = source.scene.add.sprite(source.x, source.y, source.texture.key);
    source.once('destroy', () => overlay.destroy());
  }
  overlay.setPosition(source.x, source.y).setOrigin(source.originX, source.originY)
    .setScale(source.scaleX, source.scaleY).setDepth(source.y + 20).setVisible(source.visible);
  playFacing(overlay, 'grapple_overlay', facing);
}
