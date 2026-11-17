import { pixelforgeBody } from '../../export/pixelforge.js';

// A pixel health bar over a fighter's head, in world pixels so it stays as crisp as the sprites: an ink
// outline with notched corners, a lit top row, and the fill turning amber, then brick, as it runs low.
// A hit leaves a white chunk where the lost health was, which drains a moment later. Other players carry
// their name above it (a name tag on the page, placed over the canvas every frame).
//   const bar = new HeadBar(scene, { name: 'Davis' });
//   every frame: bar.update(fraction, x, headY, delta);   when they leave: bar.destroy();

const W = 22, H = 5;                          // outer size; the fill is (W - 2) x (H - 2)
const INK = 0x12212a, EMPTY = 0x182830, EMPTY_LIT = 0x304048, CHIP = 0xf8f8f8;
const RAMPS = [                               // [from fraction, lit, fill, shade]
  [0.5, 0x9be08a, 0x63c74d, 0x3e8948],        // green
  [0.25, 0xf8d890, 0xf0a040, 0xd86830],       // amber
  [0, 0xd85a44, 0xb83028, 0x8a2420],          // brick
];
const CHIP_HOLD = 300, CHIP_DRAIN = 0.0025;   // ms the chunk stays, then fraction drained per ms
const DEPTH = 1e5;

export class HeadBar {
  constructor(scene, { name = null } = {}) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(DEPTH);
    this.value = null;
    this.chip = 0;
    this.chipWait = 0;
    this.drawn = '';
    this.label = null;
    if (name !== null) {
      this.label = nameTag(scene, name);
      // placed after the frame is drawn, when the camera has moved for it, so the tag never trails
      this.place = () => this.placeTag();
      scene.game.events.on('postrender', this.place);
    }
  }

  setName(name) {
    if (this.label && this.label.textContent !== name) this.label.textContent = name;
  }

  placeTag() {
    const { scene } = this, cam = scene.cameras?.main;
    if (!cam || this.labelAt === undefined) return;
    const box = scene.game.canvas.getBoundingClientRect(), k = box.width / scene.scale.width;
    const [x, y] = this.labelAt;
    this.label.style.transform = `translate(${Math.round(box.left + (x - cam.worldView.x) * cam.zoom * k)}px, ${Math.round(box.top + (y - cam.worldView.y) * cam.zoom * k)}px) translate(-50%, -100%)`;
    this.label.hidden = !this.g.visible || !scene.sys.isActive();
  }

  // `fraction` of health left (0..1); (x, top) is the centre just over the head.
  update(fraction, x, top, delta = 16) {
    const f = Math.max(0, Math.min(1, fraction));
    if (this.value === null) this.chip = f;
    else if (f < this.value) { this.chip = Math.max(this.chip, this.value); this.chipWait = CHIP_HOLD; }
    this.value = f;
    if (this.chip > f) {
      if (this.chipWait > 0) this.chipWait -= delta;
      else this.chip = Math.max(f, this.chip - CHIP_DRAIN * delta);
    } else this.chip = f;
    const left = Math.round(x - W / 2), y = Math.round(top - H);
    this.g.setPosition(left, y);
    this.labelAt = [x, y - 1];
    this.draw();
  }

  draw() {
    const inner = W - 2;
    const fill = Math.round(this.value * inner), chip = Math.round(this.chip * inner);
    const key = `${fill}:${chip}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const [, lit, mid, shade] = RAMPS.find(([from]) => this.value > from) ?? RAMPS[2];
    const g = this.g.clear();
    g.fillStyle(INK).fillRect(1, 0, W - 2, H).fillRect(0, 1, W, H - 2);   // outline, corners notched
    g.fillStyle(EMPTY).fillRect(1, 1, inner, H - 2);
    g.fillStyle(EMPTY_LIT).fillRect(1, 1, inner, 1);
    if (chip > fill) g.fillStyle(CHIP).fillRect(1 + fill, 1, chip - fill, H - 2);
    if (fill > 0) {
      g.fillStyle(mid).fillRect(1, 1, fill, H - 2);
      g.fillStyle(lit).fillRect(1, 1, fill, 1);
      g.fillStyle(shade).fillRect(1, H - 2, fill, 1);
    }
  }

  setVisible(on) {
    this.g.setVisible(on);
  }

  destroy() {
    this.g.destroy();
    if (this.label) {
      this.scene.game.events.off('postrender', this.place);
      this.label.remove();
    }
  }
}

// Name tags are page text over the canvas, not canvas text: the game draws at game pixels, where a name
// either smears (anti-aliased) or, as a pixel font, has to be twice a fighter's width to read. Over the
// canvas, DotGothic16 at 16px (the lobby's reading face) stays crisp and small. hud.css styles them.
let tagLayer = null;
function nameTag(scene, name) {
  if (!tagLayer) {
    tagLayer = document.createElement('div');
    tagLayer.className = 'name-tags';
    tagLayer.setAttribute('aria-hidden', 'true');
    document.body.append(tagLayer);
  }
  const el = document.createElement('span');
  el.className = 'name-tag';
  el.textContent = name;
  tagLayer.append(el);
  return el;
}

// From the feet (the origin) up to just over the head: the top of the body box.
export function headroom(scene, char) {
  const origin = scene.cache.json.get(char)?.meta?.pixelforge?.origin?.[1] ?? 52;
  return origin - (pixelforgeBody(scene, char)?.y ?? 6) + 2;
}
