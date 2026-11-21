import { spawnPixelforgeFx } from '../../export/pixelforge.js';
import { ATTACKS, BODY, DIRECTIONS } from './rules.js';
import { headroom } from '../objects/HeadBar.js';
import { touch } from './touch.js';

// What makes a crowded fight readable at a glance, drawn around every fighter:
//   a ring at the feet, amber for you and red for everyone else, so you can find yourself in a pile of 8;
//   a second, pulsing ring while a fighter's Super is ready (as in Brawl Stars), so everyone knows whom to respect;
//   a white glint on the head as a heavy move winds up (headbutt and the Supers). Their hit zones stay hidden:
//     the glint is the whole warning;
//   a shield wrapped around the three sides a block covers (all but behind), which flashes when it stops a hit;
//   "MASH!" bouncing over anyone held in a Grapple or stunned, who can press to get out sooner;
//   a word popping up over a fighter ("PERFECT" on a perfect block);
//   while your thumb drags a move's touch button to aim it, an arrow the way it will go, and for a basic move
//     (punch, kick, headbutt) its reach on the floor; a Super's zone stays hidden even then.
//
//   this.marks = new FightMarks(this, () => [{ sprite, mine, alive, superReady, block, mash }, ...]);   // every frame
//   this.marks.follow(combat);              // a TitusCombat: its heavy moves telegraph as they start, its touch aim shows
//   this.marks.telegraph(sprite, move, facing, elapsed, alive);   // a swing seen from the network
//   this.marks.flashShield(sprite);         // a blocked hit (hitFeel.js calls it)
//   this.marks.pop(sprite, 'PERFECT', color);
// Nothing is drawn for a sprite that's hidden (a dark room you aren't in).

export const GLINT = ['headbutt', 'bellow', 'grapple', 'takedown'];
const WORD = { fontFamily: '"Jersey 10", monospace', fontSize: '16px', color: '#ffffff', stroke: '#12212a', strokeThickness: 3 };
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
    this.shields = new Map();   // sprite -> [behind, in front]: the shield wraps around the fighter
    this.mashes = new Map();    // sprite -> its "MASH!"
    scene.events.on('postupdate', this.draw, this);
    scene.events.once('shutdown', () => {
      scene.events.off('postupdate', this.draw, this);
      for (const g of [...this.shields.values()].flat()) g.destroy();
      for (const t of this.mashes.values()) t.destroy();
      this.shields.clear();
      this.mashes.clear();
    });
  }

  // Telegraph this fighter's heavy moves as they start, and show its touch aim.
  follow(combat) {
    const { sprite, rules } = combat;
    this.aimer = combat;
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

  // A word over the fighter's head that jumps up and fades.
  pop(sprite, word, color = 0xffffff) {
    if (!sprite?.active || !sprite.visible) return;
    const y = sprite.y - headroom(this.scene, sprite.texture.key) - 10;
    const t = this.scene.add.text(Math.round(sprite.x), Math.round(y), word, { ...WORD, color: `#${color.toString(16).padStart(6, '0')}` })
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
      this.drawShield(f, now);
      this.drawMash(f, now);
    }
    for (const [sprite, shield] of this.shields) {
      if (!sprite.active || !fighters.some((f) => f.sprite === sprite)) { for (const g of shield) g.destroy(); this.shields.delete(sprite); }
    }
    for (const [sprite, word] of this.mashes) {
      if (!sprite.active || !fighters.some((f) => f.sprite === sprite)) { word.destroy(); this.mashes.delete(sprite); }
    }
    this.drawAim(g);
    this.telegraphs = this.telegraphs.filter((t) => {
      const age = now - t.start;
      if (age >= t.windup || !t.sprite.active || !t.alive()) return false;
      this.placeGlint(t);
      return true;
    });
  }

  // The touch move being aimed (your thumb dragging its button): an arrow the way it will go and, for a basic
  // move, its reach on the floor (anyone whose feet are inside is hit), outlined and faintly filled. A Super shows
  // only the arrow: Super hit zones stay hidden.
  drawAim(g) {
    const combat = this.aimer, aim = touch.aim;
    this.aimArrow?.setVisible(false);
    if (!combat?.sprite.active || !combat.sprite.visible || !aim?.facing) return;
    const move = aim.move === 'takedown' ? combat.rules.moves().find((m) => ATTACKS[m].character) : aim.move;
    if (!move || ATTACKS[move].radial) return;
    if (!ATTACKS[move].character) {
      const spec = ATTACKS[move], x = Math.round(combat.sprite.x), y = Math.round(combat.sprite.y) - 1;
      const [fx, fy] = DIRECTIONS[aim.facing], near = -BODY, far = spec.reach + BODY, half = (spec.width ?? 18) + BODY;
      const xs = [x + fx * near + fy * half, x + fx * far - fy * half], ys = [y + fy * near + fx * half, y + fy * far - fx * half];
      const rx = Math.min(...xs), ry = Math.min(...ys), rw = Math.abs(xs[1] - xs[0]) || 1, rh = Math.abs(ys[1] - ys[0]) || 1;
      g.fillStyle(MINE, 0.16).fillRect(rx, ry, rw, rh);
      g.fillStyle(MINE, 0.9).fillRect(rx, ry, rw, 1).fillRect(rx, ry + rh - 1, rw, 1).fillRect(rx, ry, 1, rh).fillRect(rx + rw - 1, ry, 1, rh);
    }
    // An arrowhead just past the far edge, pointing the way it will go: over the fighters, so aiming up past
    // your own head still shows. Ink-outlined amber.
    const [fx, fy] = DIRECTIONS[aim.facing], tip = ATTACKS[move].reach + BODY + 9, x = Math.round(combat.sprite.x), y = Math.round(combat.sprite.y) - 1;
    const a = (this.aimArrow ??= this.scene.add.graphics().setDepth(2e5 - 3)).clear().setVisible(true);
    const head = (color, from, rows) => {
      a.fillStyle(color, 1);
      for (let i = 0; i < rows; i++) {
        const back = tip - from - i, half = i;   // each row a pixel further back and a pixel wider either side
        a.fillRect(x + fx * back - Math.abs(fy) * half, y + fy * back - Math.abs(fx) * half, fy ? half * 2 + 1 : 1, fx ? half * 2 + 1 : 1);
      }
    };
    head(0x12212a, -1, 8);
    head(MINE, 0, 6);
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

  // A block's shield, at chest height, wrapped around the three sides it covers (all but straight behind): the
  // half nearer the camera is drawn in front of the fighter, the far half behind.
  drawShield(f, now) {
    const { sprite } = f;
    let shield = this.shields.get(sprite);
    if (!f.block || !sprite.visible) { for (const g of shield ?? []) g.setVisible(false); return; }
    if (!shield) { shield = [this.scene.add.graphics(), this.scene.add.graphics()]; this.shields.set(sprite, shield); }
    const flash = now < (sprite.shieldFlashUntil ?? 0);
    const cx = Math.round(sprite.x), cy = Math.round(sprite.y - headroom(this.scene, sprite.texture.key) * 0.45);
    const facing = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[f.block];
    const [behind, front] = shield;
    behind.clear().setVisible(true).setDepth(sprite.depth - 0.25);
    front.clear().setVisible(true).setDepth(sprite.depth + 0.25);
    const arc = (r, color, alpha) => {
      behind.fillStyle(color, alpha); front.fillStyle(color, alpha);
      const seen = new Set();
      for (let i = -60; i <= 60; i++) {
        const a = facing + i * Math.PI / 80, px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r * 0.85);
        if (!seen.has(`${px},${py}`)) { seen.add(`${px},${py}`); (py > cy ? front : behind).fillRect(px, py, 1, 1); }
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
