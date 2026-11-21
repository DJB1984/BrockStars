import { spawnPixelforgeFx } from '../../export/pixelforge.js';
import { ATTACKS, BODY, DIRECTIONS } from './rules.js';
import { headroom } from '../objects/HeadBar.js';

// What makes a crowded fight readable at a glance, drawn around every fighter:
//   a ring at the feet, amber for you and red for everyone else, so you can find yourself in a pile of 8;
//   a second, pulsing ring while a fighter's Super is ready (as in Brawl Stars), so everyone knows whom to respect;
//   a white glint on the head as a heavy move winds up (headbutt and the Supers), and a Super's reach drawn on
//     the floor through its wind-up, filling toward its edge: when the fill gets there, it fires;
//   a shield arc on the side a block covers, which flashes when it stops a hit.
//
//   this.marks = new FightMarks(this, () => [{ sprite, mine, alive, superReady, block }, ...]);   // every frame
//   this.marks.follow(combat);              // a TitusCombat: its heavy moves telegraph as they start
//   this.marks.telegraph(sprite, move, facing, elapsed, alive);   // a swing seen from the network
//   this.marks.flashShield(sprite);         // a blocked hit (hitFeel.js calls it)
// Nothing is drawn for a sprite that's hidden (a dark room you aren't in).

export const GLINT = ['headbutt', 'bellow', 'grapple', 'takedown'];
const zoned = (move) => !!ATTACKS[move]?.character;     // the Supers
const FLOOR_DEPTH = -3900;   // over the tile layers (-5000 + i) and room shadows (-4000), under every fighter
const MINE = 0xfeae34, OTHER = 0xe43b44, SHIELD = 0x2ce8f5, LIT = 0xffffff, INK = 0x124e89;

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
    this.shields = new Map();
    scene.events.on('postupdate', this.draw, this);
    scene.events.once('shutdown', () => {
      scene.events.off('postupdate', this.draw, this);
      for (const g of this.shields.values()) g.destroy();
      this.shields.clear();
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

  flashShield(sprite) { sprite.shieldFlashUntil = this.scene.time.now + 140; }

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
      this.drawShield(f, now);
    }
    for (const [sprite, shield] of this.shields) {
      if (!sprite.active || !fighters.some((f) => f.sprite === sprite)) { shield.destroy(); this.shields.delete(sprite); }
    }
    this.telegraphs = this.telegraphs.filter((t) => {
      const age = now - t.start;
      if (age >= t.windup || !t.sprite.active || !t.alive()) return false;
      this.placeGlint(t);
      if (zoned(t.move) && t.sprite.visible) this.drawZone(g, t, age / t.windup);
      return true;
    });
  }

  // The floor a Super will hit: anyone whose feet are inside it. Outlined, faintly filled, and filling from
  // the fighter outward as the wind-up runs.
  drawZone(g, t, progress) {
    const spec = ATTACKS[t.move], color = t.mine ? MINE : OTHER, x = Math.round(t.sprite.x), y = Math.round(t.sprite.y) - 1;
    if (spec.radial) {
      g.fillStyle(color, 0.1).fillCircle(x, y, spec.reach);
      g.fillStyle(color, 0.18).fillCircle(x, y, Math.max(2, spec.reach * progress));
      g.lineStyle(1, color, 0.85).strokeCircle(x, y, spec.reach);
      return;
    }
    const [fx, fy] = DIRECTIONS[t.facing], near = -BODY, far = spec.reach + BODY, half = (spec.width ?? 18) + BODY;
    const rect = (from, to) => {   // forward from..to, across ±half, as an axis-aligned rectangle
      const xs = [x + fx * from + fy * half, x + fx * to - fy * half], ys = [y + fy * from + fx * half, y + fy * to - fx * half];
      return [Math.min(...xs), Math.min(...ys), Math.abs(xs[1] - xs[0]) || 1, Math.abs(ys[1] - ys[0]) || 1];
    };
    const [rx, ry, rw, rh] = rect(near, far);
    g.fillStyle(color, 0.16).fillRect(rx, ry, rw, rh);
    g.fillStyle(color, 0.32).fillRect(...rect(near, near + (far - near) * progress));
    g.fillStyle(color, 0.9).fillRect(rx, ry, rw, 1).fillRect(rx, ry + rh - 1, rw, 1).fillRect(rx, ry, 1, rh).fillRect(rx + rw - 1, ry, 1, rh);
  }

  // A shield arc on the blocked side, at chest height: behind the fighter when they face up, in front otherwise.
  drawShield(f, now) {
    const { sprite } = f;
    let shield = this.shields.get(sprite);
    if (!f.block || !sprite.visible) { shield?.setVisible(false); return; }
    if (!shield) { shield = this.scene.add.graphics(); this.shields.set(sprite, shield); }
    const flash = now < (sprite.shieldFlashUntil ?? 0);
    const cx = Math.round(sprite.x), cy = Math.round(sprite.y - headroom(this.scene, sprite.texture.key) * 0.45);
    const facing = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[f.block];
    shield.clear().setVisible(true).setDepth(sprite.depth + (f.block === 'up' ? -0.25 : 0.25));
    const arc = (r, color, alpha) => {
      shield.fillStyle(color, alpha);
      const seen = new Set();
      for (let i = -24; i <= 24; i++) {
        const a = facing + i * Math.PI / 80, px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r * 0.85);
        if (!seen.has(`${px},${py}`)) { seen.add(`${px},${py}`); shield.fillRect(px, py, 1, 1); }
      }
    };
    // A crescent: lit on its inside edge, cyan through the middle, an ink rim outside so it reads on any floor.
    // A blocked hit turns it white for a moment and it swells by a pixel.
    const grow = flash ? 1 : 0;
    arc(19 + grow, INK, 0.9);
    arc(18 + grow, flash ? LIT : SHIELD, 1);
    arc(17 + grow, flash ? LIT : SHIELD, 1);
    arc(16, LIT, flash ? 1 : 0.7);
  }
}
