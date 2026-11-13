import { pixelforgeBody } from '../../export/pixelforge.js';

// Updates arrive ~15 times a second, a little unevenly, so each remote player is drawn DELAY_MS in the
// past, between the two updates around that moment: smooth walking instead of hops.
const DELAY_MS = 110;
const TELEPORT = 160;   // farther than this between updates (a respawn, a door) jumps instead of sliding

// The other players in this scene's level, drawn from net.players: a sprite each, playing what they play,
// with a name tag over the head. Make one in create and call update(delta) every frame.
export class RemotePlayers {
  constructor(scene, net) {
    this.scene = scene;
    this.net = net;
    this.shown = new Map();
    scene.events.once('shutdown', () => { for (const id of [...this.shown.keys()]) this.remove(id); });
  }

  update() {
    const { scene } = this, now = performance.now();
    const here = new Set();
    for (const [id, p] of Object.entries(this.net.players)) {
      if (p.level !== scene.levelName || !scene.textures.exists(p.char)) continue;
      here.add(id);
      const r = this.shown.get(id) ?? this.add(id, p);
      if (p.n !== r.n) {   // a new update: remember where, and when it came
        r.n = p.n;
        const last = r.samples.at(-1);
        if (last && Math.hypot(p.x - last.x, p.y - last.y) > TELEPORT) r.samples.length = 0;
        r.samples.push({ t: now, x: p.x, y: p.y });
        if (r.samples.length > 10) r.samples.shift();
      }
      const at = now - DELAY_MS, s = r.samples;
      while (s.length > 2 && s[1].t <= at) s.shift();
      let { x, y } = s.at(-1);
      if (s.length >= 2 && s[0].t <= at) {
        const u = Math.min(1, (at - s[0].t) / Math.max(1, s[1].t - s[0].t));
        x = s[0].x + (s[1].x - s[0].x) * u;
        y = s[0].y + (s[1].y - s[0].y) * u;
      }
      const sprite = r.sprite;
      if (sprite.texture.key !== p.char) sprite.setTexture(p.char);
      if (p.anim && scene.anims.exists(p.anim)) sprite.play(p.anim, true);
      sprite.setPosition(x, y).setFlipX(!!p.flip).setDepth(y - 0.5);   // level with you: behind you
      r.label.setText(p.name || 'Player').setPosition(Math.round(x), Math.round(y - this.headroom(p.char))).setDepth(1e5 + 1);
    }
    for (const id of [...this.shown.keys()]) if (!here.has(id)) this.remove(id);
  }

  add(id, p) {
    const sprite = this.scene.add.sprite(p.x, p.y, p.char);
    const label = this.scene.add.text(p.x, p.y, '', {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', backgroundColor: '#181425bb', padding: { x: 3, y: 1 },
    }).setOrigin(0.5, 1);
    const r = { sprite, label, n: null, samples: [] };
    this.shown.set(id, r);
    return r;
  }

  remove(id) {
    const r = this.shown.get(id);
    r.sprite.destroy();
    r.label.destroy();
    this.shown.delete(id);
  }

  // From the feet (the origin) up to just over the head: the top of the body box.
  headroom(char) {
    const origin = this.scene.cache.json.get(char)?.meta?.pixelforge?.origin?.[1] ?? 52;
    return origin - (pixelforgeBody(this.scene, char)?.y ?? 6) + 2;
  }
}
