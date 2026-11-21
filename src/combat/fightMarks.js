import { spawnPixelforgeFx } from '../../export/pixelforge.js';
import { ATTACKS, DIRECTIONS } from './rules.js';
import { headroom } from '../objects/HeadBar.js';

// What makes a crowded fight readable at a glance, drawn around every fighter:
//   a ring at the feet, amber for you and red for everyone else, so you can find yourself in a pile of 8;
//   a second, pulsing ring while a fighter's Super is ready (as in Brawl Stars), so everyone knows whom to respect;
//   a white glint on the head as a heavy move winds up (headbutt and the Supers). Their hit zones stay hidden:
//     the glint is the whole warning;
//   "MASH!" bouncing over anyone held in a Grapple or stunned, who can press to get out sooner;
//   a word popping up over a fighter ("PERFECT" on a perfect block, a bigger "KO!" on a KO).
// A block draws nothing of its own: its pose, and the blue flash and spark of a blocked hit, say it.
//
//   this.marks = new FightMarks(this, () => [{ sprite, mine, alive, superReady, mash }, ...]);   // every frame
//   this.marks.follow(combat);              // a TitusCombat: its heavy moves telegraph as they start
//   this.marks.telegraph(sprite, move, facing, elapsed, alive);   // a swing seen from the network
//   this.marks.pop(sprite, 'PERFECT', color);   // or 'KO!' bigger: pop(sprite, 'KO!', color, 24)
// Nothing is drawn for a sprite that's hidden (a dark room you aren't in).

export const GLINT = ['headbutt', 'bellow', 'grapple', 'takedown'];
const WORD = { fontFamily: '"Jersey 10", monospace', fontSize: '16px', color: '#ffffff', stroke: '#12212a', strokeThickness: 3 };
const FLOOR_DEPTH = -3900;   // over the tile layers (-5000 + i) and room shadows (-4000), under every fighter
const MINE = 0xfeae34, OTHER = 0xe43b44;

// The pixels of an ellipse's outline, one per step around it.
function ellipse(rx, ry) {
  const seen = new Set(), points = [];
  for (let i = 0; i < 720; i++) {
    const a = i * Math.PI / 360, x = Math.round(Math.cos(a) * rx), y = Math.round(Math.sin(a) * ry), k = `${x},${y}`;
    if (!seen.has(k)) { seen.add(k); points.push([x, y]); }
  }
  return points;
}
const RING = ellipse(13, 5), SUPER_RING = ellipse(17, 7);

export class FightMarks {
  constructor(scene, fighters) {
    this.scene = scene;
    this.fighters = fighters;
    this.floor = scene.add.graphics().setDepth(FLOOR_DEPTH);
    this.telegraphs = [];
    this.mashes = new Map();    // sprite -> its "MASH!"
    scene.events.on('postupdate', this.draw, this);
    scene.events.once('shutdown', () => {
      scene.events.off('postupdate', this.draw, this);
      for (const t of this.mashes.values()) t.destroy();
      this.mashes.clear();
    });
  }

  // Telegraph this fighter's heavy moves as they start.
  follow(combat) {
    const { sprite, rules } = combat;
    const start = () => {
      const attack = rules.attack;
      if (attack) this.telegraph(sprite, attack.name, attack.facing, 0, () => rules.attack === attack, true);
    };
    sprite.on('pixelforge-attack', start);
    this.scene.events.once('shutdown', () => sprite.off('pixelforge-attack', start));
  }

  // `elapsed` ms of the wind-up already gone (a swing seen late over the network); `alive()` false once the
  // move is interrupted or over. Fast moves aren't telegraphed: a 70 ms punch can't be seen in time anyway.
  telegraph(sprite, move, facing, elapsed = 0, alive = () => true, mine = false) {
    const spec = ATTACKS[move], windup = spec?.frames[0] ?? 0;
    if (!GLINT.includes(move) || elapsed >= windup || !sprite?.active) return;
    const t = { sprite, move, facing, start: this.scene.time.now - elapsed, windup, alive, mine, glint: null };
    if (sprite.visible && this.scene.cache.json.get('fx_glint')?.meta?.pixelforge) {
      t.glint = spawnPixelforgeFx(this.scene, sprite.x, sprite.y, 'fx_glint');
      this.placeGlint(t);
    }
    this.telegraphs = this.telegraphs.filter((o) => o.sprite !== sprite);
    this.telegraphs.push(t);
  }

  // A word over the fighter's head that jumps up and fades; `size` in px (16, or bigger for a KO).
  pop(sprite, word, color = 0xffffff, size = 16) {
    if (!sprite?.active || !sprite.visible) return;
    const y = sprite.y - headroom(this.scene, sprite.texture.key) - 10;
    const t = this.scene.add.text(Math.round(sprite.x), Math.round(y), word, { ...WORD, fontSize: `${size}px`, strokeThickness: size > 16 ? 4 : 3, color: `#${color.toString(16).padStart(6, '0')}` })
      .setOrigin(0.5, 1).setDepth(2e5 - 1).setResolution(3);
    this.scene.tweens.add({ targets: t, y: y - 12, duration: 260, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 420, duration: 200, onComplete: () => t.destroy() });
  }

  // On the forehead, toward the side they face.
  placeGlint(t) {
    const { sprite, facing, glint } = t;
    if (!glint?.active) return;
    const [fx] = DIRECTIONS[facing];
    glint.setPosition(Math.round(sprite.x + fx * 5), Math.round(sprite.y - headroom(this.scene, sprite.texture.key) + 9))
      .setDepth(sprite.depth + 2).setVisible(sprite.visible);
  }

  draw() {
    const now = this.scene.time.now, g = this.floor.clear();
    const fighters = this.fighters().filter((f) => f.sprite?.active);
    for (const f of fighters) {
      const { sprite } = f;
      const color = f.mine ? MINE : OTHER, x = Math.round(sprite.x), y = Math.round(sprite.y) - 1;
      if (sprite.visible && f.alive !== false) {
        g.fillStyle(color, f.mine ? 0.95 : 0.8);
        for (const [dx, dy] of RING) g.fillRect(x + dx, y + dy, 1, 1);
        if (f.superReady) {
          g.fillStyle(color, 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(now / 140)));
          for (const [dx, dy] of SUPER_RING) g.fillRect(x + dx, y + dy, 1, 1);
        }
      }
      this.drawMash(f, now);
    }
    for (const [sprite, word] of this.mashes) {
      if (!sprite.active || !fighters.some((f) => f.sprite === sprite)) { word.destroy(); this.mashes.delete(sprite); }
    }
    this.telegraphs = this.telegraphs.filter((t) => {
      const age = now - t.start;
      if (age >= t.windup || !t.sprite.active || !t.alive()) return false;
      this.placeGlint(t);
      return true;
    });
  }

  // "MASH!" over a fighter who's held or stunned, bouncing a pixel every few frames so it reads as "press!".
  drawMash(f, now) {
    const { sprite } = f;
    let word = this.mashes.get(sprite);
    if (!f.mash || !sprite.visible || f.alive === false) { word?.setVisible(false); return; }
    if (!word) { word = this.scene.add.text(0, 0, 'MASH!', { ...WORD, color: '#feae34' }).setOrigin(0.5, 1).setResolution(3); this.mashes.set(sprite, word); }
    const bounce = Math.floor(now / 90) % 2;
    word.setVisible(true).setDepth(2e5 - 2)
      // Above the name tag, for another player.
      .setPosition(Math.round(sprite.x) + (Math.floor(now / 45) % 2 ? 1 : -1), Math.round(sprite.y - headroom(this.scene, sprite.texture.key) - (sprite.netId ? 20 : 8) - bounce * 2));
  }
}
