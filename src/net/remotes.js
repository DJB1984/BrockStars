import { updateBellowVisuals } from '../combat/bellowVisuals.js';
import { characterStats } from '../characters.js';
import { showGrappleOverlay } from '../combat/grappleVisuals.js';
import { ATTACKS, DODGE, attackAnim } from '../combat/rules.js';
import { dodgeTrail } from '../combat/dodge.js';
import { HeadBar, headroom } from '../objects/HeadBar.js';
import { KO, holdLying, koAlpha, safeAlpha } from '../combat/match.js';

// Updates arrive ~15 times a second, a little unevenly, so each remote player is drawn DELAY_MS in the
// past, between the two updates around that moment: smooth walking instead of hops. Each update also
// remembers the host's clock it came from, so seenTime() can tell the host which moment this screen shows
// (the host judges this player's attacks against it: lag compensation in combat.js).
export const DELAY_MS = 110;
const TELEPORT = 160;   // farther than this between updates (a respawn, a door) jumps instead of sliding

// The other players in this scene's level, drawn from net.players: a sprite each, playing what they play,
// with their name and health bar over the head (hidden while they're in a room you can't see into: the
// scene's `rooms`). Make one in create and call update(delta) every frame.
// KO'd (match.js), a player lies in the knockdown pose and fades out until they respawn; back, they blink while
// they can't be hit. Their name tag carries a small crown for the session's leader, and their KO streak.
export class RemotePlayers {
  constructor(scene, net) {
    this.scene = scene;
    this.net = net;
    this.shown = new Map();
    // A remote swing that lands on anyone isn't a whiff (the scene's hitFeel makes the hit itself felt).
    const hits = ({hits}) => {
      for (const hit of hits) {
        const r = this.shown.get(hit.source);
        if (r) r.landedAt = performance.now();
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
        // h: the host's clock for this position (on the host, when it arrived; on a client, the snapshot's).
        r.samples.push({ t: now, x: p.x, y: p.y, h: this.net.role === 'host' ? (p.heard ?? now) : (this.net.snapTime ?? now) });
        if (r.samples.length > 10) r.samples.shift();
      }
      const at = now - DELAY_MS, s = r.samples;
      while (s.length > 2 && s[1].t <= at) s.shift();
      let { x, y, h } = s.at(-1);
      if (s.length >= 2 && s[0].t <= at) {
        const u = Math.min(1, (at - s[0].t) / Math.max(1, s[1].t - s[0].t));
        x = s[0].x + (s[1].x - s[0].x) * u;
        y = s[0].y + (s[1].y - s[0].y) * u;
        h = s[0].h + (s[1].h - s[0].h) * u;
      }
      r.seen = h;
      const sprite = r.sprite;
      if (sprite.texture.key !== p.char) sprite.setTexture(p.char);
      const combat = this.net.combatState.fighters[id];
      if (combat?.stunPosition) ({x, y} = combat.stunPosition);
      if (combat?.held) ({x, y} = combat.held);
      if (combat?.grapple) ({x, y} = combat.grapple);
      const hurt = combat?.stagger && !combat.knockdown && !combat.stun && combat.health ? combat.hurtFacing : null;
      const ko = combat?.ko && !combat.health ? combat.ko : null;
      const facing = (ko ? ko.facing : null) ?? (combat?.stun ? combat.stunFacing : null) ?? combat?.held?.facing ?? (combat?.knockdown ? combat.knockdownFacing : null) ?? combat?.attack?.facing ?? combat?.block ?? hurt;
      const dir = facing === 'left' || facing === 'right' ? 'side' : facing;
      let anim = p.anim;
      if (ko) anim = `${p.char}_knockdown_${dir ?? 'down'}`;
      else if (combat?.stun) anim = `${p.char}_stunned_${dir ?? 'down'}`;
      else if (combat?.held) anim = `${p.char}_grappled_${dir ?? 'down'}`;
      else if (combat?.knockdown) anim = `${p.char}_knockdown_${dir ?? 'down'}`;
      else if (combat?.attack) {
        // A new attack (none before, or its clock restarted) counts toward alternating punch hands.
        const started = !r.attack || combat.attack.elapsed < r.attack.elapsed;
        if (started) {
          r.swingStart = now - combat.attack.elapsed; r.whiffed = false;
          // A heavy move winding up glints, and a Super draws its reach on the floor (fightMarks.js).
          const { name, facing, elapsed } = combat.attack, start = r.swingStart;
          scene.marks?.telegraph(sprite, name, facing, elapsed, () => this.shown.get(id)?.swingStart === start && this.shown.get(id)?.attack?.name === name);
        }
        if (started && combat.attack.name === 'punch') r.punches = (r.punches ?? -1) + 1;
        anim = attackAnim(p.char, combat.attack.name, combat.attack.facing, r.punches ?? 0, key => scene.anims.exists(key));
        // Its active frames are over and it touched nobody since it started: a whiff.
        const [windup, active] = ATTACKS[combat.attack.name].frames;
        if (!r.whiffed && combat.attack.elapsed >= windup + active && !((r.landedAt ?? -Infinity) >= r.swingStart)) {
          r.whiffed = true;
          scene.hitFeel?.whiff(sprite, combat.attack.name, combat.attack.facing);
        }
      }
      else if (combat?.block) anim = `${p.char}_block_${dir}`;
      else if (hurt && scene.anims.exists(`${p.char}_hurt_${dir}`)) anim = `${p.char}_hurt_${dir}`;
      else if (combat && (!combat.health || combat.stagger)) anim = `${p.char}_idle_down`;
      r.attack = combat?.attack ?? null;
      // What fightMarks.js draws around them: the second ring when their Super is ready, "MASH!" when held or stunned.
      const special = Object.keys(ATTACKS).find(name => ATTACKS[name].character === p.char);
      sprite.alive = (combat?.health ?? 1) > 0;
      sprite.mash = !!(combat?.held || combat?.stun);   // fightMarks.js: "MASH!" over them
      // A new dodge (each carries its own start): the same afterimages as yours.
      if (p.dodge && p.dodge !== r.dodge) dodgeTrail(scene, sprite, DODGE.duration);
      r.dodge = p.dodge;
      sprite.superReady = !!combat && sprite.alive && !!special && !combat[`${special}Cooldown`];
      const frozen = sprite.hitFreeze;   // a hit's freeze (hitFeel.js) holds the sprite's spot and pose
      if (anim && scene.anims.exists(anim)) {
        if (frozen) {
          // Change pose (into the hurt pose, say), but stay paused on it until the freeze ends.
          if (sprite.anims.currentAnim?.key !== anim) sprite.play(anim).anims.pause();
        } else if (ko) {
          if (sprite.anims.currentAnim?.key !== anim) sprite.play(anim);
          holdLying(sprite);
        } else {
          sprite.play(anim, true);
          if (combat?.knockdown) sprite.anims.setProgress(Math.min(0.99, 1-combat.knockdown/1500));
          else if (fresh && combat?.attack) {
            const duration = ATTACKS[combat.attack.name].frames.reduce((a,b)=>a+b,0);
            sprite.anims.setProgress(Math.min(0.99, combat.attack.elapsed/duration));
          }
        }
      }
      if (!frozen) sprite.setPosition(x, y).setDepth(y - 0.5);
      // Down: lying there, then fading (timed from the KO, however late this screen heard of it). Back: blinking.
      if (ko) r.koStart ??= now - (KO.respawn - ko.left);
      else r.koStart = undefined;
      sprite.setAlpha(ko ? koAlpha(now - r.koStart) : combat?.safe ? safeAlpha(now) : 1);
      sprite.safe = !!combat?.safe;
      sprite.setFlipX(facing ? facing === 'left' : !!p.flip);
      r.bar.setName(p.name || 'Player');
      r.bar.setBadges({ crown: this.net.combatState.leader === id, streak: (combat?.score?.streak ?? 0) >= KO.streak ? combat.score.streak : 0 });
      r.bar.update((combat?.health ?? characterStats(p.char).health) / (combat?.maxHealth ?? characterStats(p.char).health), x, y - headroom(scene, p.char), delta);
      const seen = scene.rooms?.canSee(x, y) ?? true;   // hidden in a room you aren't in
      sprite.setVisible(seen);
      updateBellowVisuals(scene, sprite, combat?.attack ? { ...combat.attack, start:scene.time.now-combat.attack.elapsed } : null, combat?.stun ?? 0);
      showGrappleOverlay(sprite, combat?.grapple?.facing, !!combat?.grapple);
      r.bar.setVisible(seen && !(ko && koAlpha(now - r.koStart) <= 0));   // the tag goes with the body
    }
    for (const id of [...this.shown.keys()]) if (!here.has(id)) this.remove(id);
  }

  // The sprite drawn for a player id, if they're in this level.
  sprite(id) { return this.shown.get(id)?.sprite ?? null; }

  // The host time this screen shows the others at, by the one nearest this player (the one you'd swing at).
  seenTime() {
    const me = this.scene.level?.player;
    let best = null;
    for (const r of this.shown.values()) {
      if (r.seen === undefined) continue;
      const d = me ? Math.hypot(r.sprite.x - me.x, r.sprite.y - me.y) : 0;
      if (!best || d < best.d) best = { d, seen: r.seen };
    }
    return best?.seen ?? null;
  }

  // Every remote player you can see.
  sprites() { return [...this.shown.values()].map(r => r.sprite).filter(s => s.active && s.visible); }

  // How many of them are on the camera right now.
  onScreen() {
    const view = this.scene.cameras.main.worldView;
    return this.sprites().filter(s => view.contains(s.x, s.y)).length;
  }

  add(id, p) {
    const sprite = this.scene.add.sprite(p.x, p.y, p.char);
    sprite.netId = id;
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
