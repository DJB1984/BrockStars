import { spawnPixelforgeFx } from '../../export/pixelforge.js';
import { ATTACKS, DIRECTIONS } from './rules.js';
import { headroom } from '../objects/HeadBar.js';
import { clank, hearing, hitSound, koSting, parryTing, whoosh } from '../sound.js';
import { KO } from './match.js';

// How a connecting hit feels, per move: the freeze on contact (ms; Smash's hitlag, longer for heavier
// hits), the camera shake for the two fighters involved ([ms, px]) and the spark at the contact point.
export const HIT_FEEL = Object.freeze({
  punch: { freeze: 60, shake: [60, 1], spark: 'fx_hit' },
  kick: { freeze: 90, shake: [80, 1], spark: 'fx_hit' },
  headbutt: { freeze: 130, shake: [100, 2], spark: 'fx_hit_heavy' },
  bellow: { freeze: 160, shake: [100, 2], spark: 'fx_hit_heavy' },
  grapple: { freeze: 160, shake: [100, 2], spark: 'fx_hit_heavy' },
  takedown: { freeze: 160, shake: [100, 2], spark: 'fx_hit_heavy' },
});
// With this many fighters on screen the freeze shortens, as Smash does in party matches, so a crowded
// brawl keeps moving.
export const CROWD = 4;

// The freeze for a hit: a blocked one stops for half as long.
export function freezeTime(move, crowd = 2, blocked = false) {
  return Math.round((HIT_FEEL[move]?.freeze ?? 0) * (crowd >= CROWD ? 0.75 : 1) * (blocked ? 0.5 : 1));
}

// Every hit's feel in one place, whoever threw it: a local swing, an enemy, or a hit the host resolved.
//   const hitFeel = new HitFeel(this, { me: () => player, crowd: () => fightersOnScreen });
//   hitFeel.land(attacker, victim, 'punch', result);   // after the victim's applyHit, so its hurt pose freezes
//   hitFeel.whiff(attacker, 'punch', 'right');         // a swing that connected with nobody
//   hitFeel.swing(attacker, 'punch');                  // a swing starting: its whoosh (sound.js)
// land() freezes both fighters (only those two: the rest of the brawl keeps moving), shakes the victim
// in place, flashes them, sparks at the contact point and shakes the camera, but only on the screen of
// someone in the fight. A frozen sprite carries `hitFreeze`: TitusCombat and RemotePlayers leave it alone.
// The hit that KOs (result.ko) lands harder whatever the move: KO.freeze for both, the heavy spark, a bigger
// shake, and "KO!" popping over the body.
// Every hit is heard on the frame its freeze starts (sound.js): the move's own hit sound, a clank when it's
// blocked, a sting on a KO. Full volume for a fight you're in; anyone else's fades with distance and is muted
// in a room you can't see into.
export class HitFeel {
  constructor(scene, { me = () => null, crowd = () => 2 } = {}) {
    this.scene = scene;
    this.me = me;
    this.crowd = crowd;
    this.frozen = new Set();
    // On postupdate: after physics has moved every body, before anything is drawn.
    scene.events.on('postupdate', this.hold, this);
    scene.events.once('shutdown', () => { scene.events.off('postupdate', this.hold, this); this.frozen.clear(); });
  }

  // `result` is what CombatRules.receive returned (damage, blocked, knockdown...). A hit with no attacker
  // (a burning shower) only flashes. freezeAttacker: false when the attacker has already moved on (a
  // confirmation from the host that arrives after the swing ended).
  land(attacker, victim, move, result, { freezeAttacker = true } = {}) {
    if (result?.perfect) return this.parry(victim, attacker);
    if (!victim?.active || !result?.damage) return;
    const blocked = !!result.blocked, feel = HIT_FEEL[move];
    if (!result.knockdown) this.scene.feel?.flash(victim, 90, blocked ? 0x77bbff : 0xffffff);
    const ko = !!result.ko, me = this.me(), mine = !!me && (attacker === me || victim === me);
    const loud = hearing(this.scene, victim, mine);
    if (ko) {
      this.scene.marks?.pop(victim, 'KO!', 0xe43b44, 24);   // a shower's KO too
      koSting(this.scene, mine ? 1 : loud * 0.6);            // loudest for the one KO'd and the one who did it
    }
    if (!feel || !attacker?.active) return;
    if (blocked && !ko) clank(this.scene, loud);
    else hitSound(this.scene, move, loud);
    const ms = ko ? KO.freeze : freezeTime(move, this.crowd(), blocked);
    this.freeze(victim, ms, !blocked);
    if (freezeAttacker) this.freeze(attacker, ms);
    this.spark(attacker, victim, ko ? 'fx_hit_heavy' : blocked ? 'fx_block' : feel.spark);
    if (!blocked && mine) this.scene.feel?.shake(...(ko ? [160, 3] : feel.shake));
  }

  // A perfect block: the attacker is caught in a longer, shaking freeze than the blocker's,
  // a block spark pops, it tings, and "PERFECT" pops over the blocker. The attacker's stagger is the rules'.
  parry(blocker, attacker) {
    if (!blocker?.active) return;
    this.scene.marks?.pop(blocker, 'PERFECT', 0x2ce8f5);
    this.scene.feel?.flash(blocker, 90, 0xffffff);
    const me = this.me(), mine = !!me && (attacker === me || blocker === me);
    parryTing(this.scene, hearing(this.scene, blocker, mine));
    if (!attacker?.active) return;
    this.freeze(blocker, 60);
    this.freeze(attacker, 140, true);
    this.spark(attacker, blocker, 'fx_block');
    if (mine) this.scene.feel?.shake(80, 1);
  }

  // A swing starting (`elapsed` ms ago: an online player's shows up a little late): its whoosh, from the
  // wind-up on, so a miss is heard too and the hit sound has something to land on.
  swing(attacker, move, elapsed = 0) {
    if (!attacker?.active) return;
    whoosh(this.scene, move, hearing(this.scene, attacker, attacker === this.me()), elapsed);
  }

  // A swing that missed: a puff of air in front of the fighter, and no freeze.
  whiff(attacker, move, facing) {
    const spec = ATTACKS[move];
    if (!spec || spec.radial || spec.hold || !attacker?.active || !this.visible('fx_swish', attacker)) return;
    const [fx, fy] = DIRECTIONS[facing], ahead = spec.reach * 0.6;
    spawnPixelforgeFx(this.scene, Math.round(attacker.x + fx * ahead), Math.round(attacker.y - chest(this.scene, attacker) + fy * ahead * 0.6),
      'fx_swish', undefined, { flipX: facing === 'left', rotation: fy * Math.PI / 2, depth: attacker.depth + (facing === 'up' ? -1 : 1) });
  }

  // Holds `sprite` still for `ms`: its animation paused, its body stopped where it stood, and, with
  // `shake`, jittering 1px side to side every frame. A second freeze extends it.
  freeze(sprite, ms, shake = false) {
    if (!sprite?.active || ms <= 0) return;
    const until = this.scene.time.now + ms, f = sprite.hitFreeze;
    if (f) { f.until = Math.max(f.until, until); f.shake ||= shake; return; }
    sprite.hitFreeze = { until, x: sprite.x, y: sprite.y, shake, tick: 0, velocity: null };
    sprite.anims?.pause();
    this.frozen.add(sprite);
  }

  hold() {
    const now = this.scene.time.now;
    for (const s of this.frozen) {
      const f = s.hitFreeze;
      if (!s.active || !f) { this.frozen.delete(s); if (f) delete s.hitFreeze; continue; }
      if (now >= f.until) {
        this.frozen.delete(s);
        delete s.hitFreeze;
        s.setPosition(f.x, f.y);
        s.anims?.resume();
        // Whatever pushed the body while it was held (a knockback) carries on from here.
        if (f.velocity) s.body?.setVelocity(f.velocity.x, f.velocity.y);
        continue;
      }
      if (s.anims?.isPlaying) s.anims.pause();   // something called play() during the freeze
      const v = s.body?.velocity;
      if (v && (v.x || v.y)) { f.velocity = { x: v.x, y: v.y }; s.body.setVelocity(0, 0); }
      f.tick++;
      s.setPosition(f.x + (f.shake ? (f.tick % 2 ? 1 : -1) : 0), f.y);
    }
  }

  spark(attacker, victim, name) {
    if (!this.visible(name, victim)) return;
    // On the victim's body, on the side the hit came from, at chest height.
    const dx = attacker.x - victim.x, dy = attacker.y - victim.y, d = Math.hypot(dx, dy) || 1, toward = Math.min(d / 2, 10);
    spawnPixelforgeFx(this.scene, Math.round(victim.x + dx / d * toward), Math.round(victim.y + dy / d * toward - chest(this.scene, victim)),
      name, undefined, { depth: Math.max(victim.depth, attacker.depth) + 1 });
  }

  // The effect is loaded, and the spot isn't in a dark room the player can't see into.
  visible(name, sprite) {
    return !!this.scene.cache.json.get(name)?.meta?.pixelforge && (this.scene.rooms?.canSee(sprite.x, sprite.y) ?? true);
  }
}

const chest = (scene, sprite) => Math.round(headroom(scene, sprite.texture.key) * 0.55);
