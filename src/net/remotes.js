import { updateBellowVisuals } from '../combat/bellowVisuals.js';
import { characterStats } from '../characters.js';
import { showGrappleOverlay } from '../combat/grappleVisuals.js';
import { ATTACKS, attackAnim } from '../combat/rules.js';
import { HeadBar, headroom } from '../objects/HeadBar.js';

// Updates arrive ~15 times a second, a little unevenly, so each remote player is drawn DELAY_MS in the
// past, between the two updates around that moment: smooth walking instead of hops.
const DELAY_MS = 110;
const TELEPORT = 160;   // farther than this between updates (a respawn, a door) jumps instead of sliding

// The other players in this scene's level, drawn from net.players: a sprite each, playing what they play,
// with their name and health bar over the head (hidden while they're in a room you can't see into: the
// scene's `rooms`). Make one in create and call update(delta) every frame.
export class RemotePlayers {
  constructor(scene, net) {
    this.scene = scene;
    this.net = net;
    this.shown = new Map();
    const hits = ({hits}) => {
      for (const hit of hits) {
        const sprite = this.shown.get(hit.target)?.sprite;
        if (sprite && !hit.knockdown) scene.feel?.flash(sprite, 90, hit.blocked ? 0x77bbff : 0xffffff);
      }
    };
    net.on('combat', hits);
    scene.events.once('shutdown', () => net.off('combat', hits));
    scene.events.once('shutdown', () => { for (const id of [...this.shown.keys()]) this.remove(id); });
  }

  update(delta) {
    const { scene } = this, now = performance.now();
    const here = new Set();
    for (const [id, p] of Object.entries(this.net.players)) {
      if (p.level !== scene.levelName || !scene.textures.exists(p.char)) continue;
      here.add(id);
      const r = this.shown.get(id) ?? this.add(id, p);
      const fresh = p.n !== r.n;
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
      const combat = this.net.combatState.fighters[id];
      if (combat?.stunPosition) ({x, y} = combat.stunPosition);
      if (combat?.held) ({x, y} = combat.held);
      if (combat?.grapple) ({x, y} = combat.grapple);
      const facing = (combat?.stun ? combat.stunFacing : null) ?? combat?.held?.facing ?? (combat?.knockdown ? combat.knockdownFacing : null) ?? combat?.attack?.facing ?? combat?.block;
      const dir = facing === 'left' || facing === 'right' ? 'side' : facing;
      let anim = p.anim;
      if (combat?.stun) anim = `${p.char}_stunned_${dir ?? 'down'}`;
      else if (combat?.held) anim = `${p.char}_grappled_${dir ?? 'down'}`;
      else if (combat?.knockdown) anim = `${p.char}_knockdown_${dir ?? 'down'}`;
      else if (combat?.attack) {
        // A new attack (none before, or its clock restarted) counts toward alternating punch hands.
        const started = !r.attack || combat.attack.elapsed < r.attack.elapsed;
        if (started && combat.attack.name === 'punch') r.punches = (r.punches ?? -1) + 1;
        anim = attackAnim(p.char, combat.attack.name, combat.attack.facing, r.punches ?? 0, key => scene.anims.exists(key));
      }
      else if (combat?.block) anim = `${p.char}_block_${dir}`;
      else if (combat && (!combat.health || combat.stagger)) anim = `${p.char}_idle_down`;
      if (anim && scene.anims.exists(anim)) {
        sprite.play(anim, true);
        if (combat?.knockdown) sprite.anims.setProgress(Math.min(0.99, 1-combat.knockdown/1500));
        else if (fresh && combat?.attack) {
          const duration = ATTACKS[combat.attack.name].frames.reduce((a,b)=>a+b,0);
          sprite.anims.setProgress(Math.min(0.99, combat.attack.elapsed/duration));
        }
      }
      r.attack = combat?.attack ?? null;
      sprite.setPosition(x, y).setFlipX(facing ? facing === 'left' : !!p.flip).setDepth(y - 0.5);
      r.bar.setName(p.name || 'Player');
      r.bar.update((combat?.health ?? characterStats(p.char).health) / (combat?.maxHealth ?? characterStats(p.char).health), x, y - headroom(scene, p.char), delta);
      const seen = scene.rooms?.canSee(x, y) ?? true;   // hidden in a room you aren't in
      sprite.setVisible(seen);
      updateBellowVisuals(scene, sprite, combat?.attack ? { ...combat.attack, start:scene.time.now-combat.attack.elapsed } : null, combat?.stun ?? 0);
      showGrappleOverlay(sprite, combat?.grapple?.facing, !!combat?.grapple);
      r.bar.setVisible(seen);
    }
    for (const id of [...this.shown.keys()]) if (!here.has(id)) this.remove(id);
  }

  add(id, p) {
    const sprite = this.scene.add.sprite(p.x, p.y, p.char);
    const bar = new HeadBar(this.scene, { name: p.name || 'Player' });
    const r = { sprite, bar, n: null, samples: [] };
    this.shown.set(id, r);
    return r;
  }

  remove(id) {
    const r = this.shown.get(id);
    r.sprite.destroy();
    r.bar.destroy();
    this.shown.delete(id);
  }
}
