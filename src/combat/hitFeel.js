import { spawnPixelforgeFx } from '../../export/pixelforge.js';
import { ATTACKS, DIRECTIONS } from './rules.js';
import { headroom } from '../objects/HeadBar.js';

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
// land() freezes both fighters (only those two: the rest of the brawl keeps moving), shakes the victim
// in place, flashes them, sparks at the contact point and shakes the camera, but only on the screen of
// someone in the fight. A frozen sprite carries `hitFreeze`: TitusCombat and RemotePlayers leave it alone.
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
    if (!victim?.active || !result?.damage) return;
    const blocked = !!result.blocked, feel = HIT_FEEL[move];
    if (blocked) this.scene.marks?.flashShield(victim);   // the shield arc that stopped it (fightMarks.js)
    if (!result.knockdown) this.scene.feel?.flash(victim, 90, blocked ? 0x77bbff : 0xffffff);
    if (!feel || !attacker?.active) return;
    const ms = freezeTime(move, this.crowd(), blocked);
    this.freeze(victim, ms, !blocked);
    if (freezeAttacker) this.freeze(attacker, ms);
    this.spark(attacker, victim, blocked ? 'fx_block' : feel.spark);
    const me = this.me();
    if (!blocked && me && (attacker === me || victim === me)) this.scene.feel?.shake(...feel.shake);
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
