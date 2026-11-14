import { playFacing, pixelforgeBoxes } from '../../export/pixelforge.js';
import { ATTACKS, BLOCK, CombatRules, directionTo, DIRECTIONS } from './rules.js';

// Extend the existing Pixel Forge movement controller; keep its physics, input overrides and playtest API.
export class TitusCombat {
  constructor(scene, sprite, { health, targets = () => [], onHit = () => {} } = {}) {
    this.scene = scene;
    this.sprite = sprite;
    this.rules = new CombatRules(health);
    this.targets = targets;
    this.onHit = onHit;
    this.struck = new Set();
    sprite.combat = this;
    const c = sprite.controller;
    this.controller = c;
    const read = c.readInput.bind(c), move = c.updateTopdown.bind(c);
    const keys = scene.input.keyboard.addKeys('C,X,Z,V');
    c.readInput = () => {
      const input = read();
      return { ...input, attack: false,
        punch: c.override ? !!c.override.punch : keys.C.isDown,
        kick: c.override ? !!c.override.kick : keys.X.isDown,
        headbutt: c.override ? !!c.override.headbutt : keys.Z.isDown,
        block: c.override ? !!c.override.block : keys.V.isDown };
    };
    const update = c.update.bind(c);
    c.update = (time) => {
      if (time < (c.stunnedUntil ?? 0)) {
        // Presses during knockback are consumed too, so held keys cannot become queued attacks.
        const input = c.readInput();
        this.rules.previous = { ...input };
        if (this.rules.block && (!input.block || time >= this.rules.block.until)) {
          this.rules.endBlock(time);
          sprite.emit('combat-release');
        }
      }
      update(time);
    };
    c.updateTopdown = (input) => {
      const now = scene.time.now, old = this.rules.attack;
      const wasBlocking = !!this.rules.block;
      // Face a newly pressed movement direction before starting an action.
      if (!old && !this.rules.block) {
        const dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
        if (dx || dy) c.facing = dx ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      }
      this.rules.update(now, input, c.facing);
      if (!wasBlocking && this.rules.block) sprite.emit('combat-block', this.rules.block.facing);
      if (wasBlocking && !this.rules.block) sprite.emit('combat-release');
      if (!old && this.rules.attack) {
        this.struck.clear();
        c.busy = `${sprite.texture.key}_${this.rules.attack.name}_${this.rules.attack.facing === 'left' || this.rules.attack.facing === 'right' ? 'side' : this.rules.attack.facing}`;
        playFacing(sprite, this.rules.attack.name, this.rules.attack.facing);
        sprite.emit('pixelforge-attack', sprite);
      }
      const action = this.rules.attack ?? this.rules.block;
      if (this.rules.health.value <= 0) { sprite.body.setVelocity(0, 0); return; }
      if (action) {
        c.facing = action.facing;
        if (this.rules.block) playFacing(sprite, 'block', action.facing);
        const dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
        const length = Math.hypot(dx, dy) || 1;
        const speed = c.opts.speed * (this.rules.block ? BLOCK.speed : 0.6);
        sprite.body.setVelocity(dx / length * speed, dy / length * speed);
        sprite.setDepth(sprite.y);
      } else {
        c.busy = null;
        move(input);
        // Keep diagonal movement at the same speed as cardinal movement.
        if (sprite.body.velocity.length() > c.opts.speed) sprite.body.velocity.normalize().scale(c.opts.speed);
      }
    };
    const complete = (animation) => {
      if (this.rules.attack && animation.key === c.busy) { this.rules.finishAttack(); c.busy = null; }
      // Pixel Forge's own completion listener clears busy first.
      else if (this.rules.attack && animation.key.startsWith(`${sprite.texture.key}_${this.rules.attack.name}_`)) this.rules.finishAttack();
    };
    const hit = () => this.checkHits();
    sprite.on('animationcomplete', complete);
    sprite.on('animationupdate', hit);
    scene.events.on('postupdate', hit);
    scene.events.once('shutdown', () => {
      scene.events.off('postupdate', hit);
      sprite.off('animationcomplete', complete);
      sprite.off('animationupdate', hit);
    });
  }
  checkHits() {
    const attack = this.rules.attack;
    if (!attack || !this.sprite.active || this.rules.health.value <= 0) return;
    const hits = pixelforgeBoxes(this.sprite, 'hit');
    if (!hits.length) return;
    const spec = ATTACKS[attack.name];
    for (const target of this.targets()) {
      if (!target.active || target === this.sprite || this.struck.has(target)) continue;
      const dx = target.x - this.sprite.x, dy = target.y - this.sprite.y;
      const [fx, fy] = DIRECTIONS[attack.facing];
      const forward = dx * fx + dy * fy, across = Math.abs(dx * fy - dy * fx);
      // In this three-quarter view a head and boot have different drawn heights. Combat range
      // lives on the ground plane so rotating the same move never changes its reach.
      // The exported art still determines the active frames, never the wind-up or recovery.
      if (forward < 0 || forward > spec.reach || across > 18) continue;
      this.struck.add(target);
      const result = target.combat ? target.combat.receive(this.sprite, spec) : target.actor?.hit(this.sprite, spec);
      this.onHit(target, attack.name, result);
      this.sprite.emit('pixelforge-hit', target);
    }
  }
  drawReach(graphics) {
    const attack = this.rules.attack;
    if (!attack || !pixelforgeBoxes(this.sprite, 'hit').length) return;
    const reach=ATTACKS[attack.name].reach, [x,y]=[this.sprite.x,this.sprite.y];
    const boxes={right:[x,y-18,reach,36],left:[x-reach,y-18,reach,36],up:[x-18,y-reach,36,reach],down:[x-18,y,36,reach]};
    graphics.lineStyle(1,0xff5577).strokeRect(...boxes[attack.facing]);
  }
  receive(from, spec) {
    const result = this.rules.receive(spec, directionTo(from.x - this.sprite.x, from.y - this.sprite.y), this.scene.time.now);
    return this.applyHit(from, result);
  }
  // Network damage is already resolved by the host; apply its visual/physics result once.
  applyHit(from, result) {
    if (!result.damage) return result;
    this.scene.feel?.flash(this.sprite, 90, result.blocked ? 0x77bbff : 0xffffff);
    if (result.stagger) {
      this.rules.attack = null;
      this.rules.staggerUntil = this.scene.time.now + result.stagger;
      if (this.rules.block) this.rules.endBlock(this.scene.time.now);
      this.controller.busy = null;
      playFacing(this.sprite, 'idle', this.controller.facing);
    }
    // A brief push for light attacks; headbutt holds the victim in recovery longer.
    const pushTime = result.stagger || 80;
    this.controller.stun(pushTime);
    const dx = this.sprite.x - from.x, dy = this.sprite.y - from.y, length = Math.hypot(dx, dy) || 1;
    this.sprite.body.setVelocity(dx / length * result.knockback, dy / length * result.knockback);
    this.scene.time.delayedCall(pushTime, () => { if (this.sprite.active) this.sprite.body.setVelocity(0, 0); });
    return result;
  }
  snapshot() {
    const now = this.scene.time.now;
    return { attack: this.rules.attack?.name ?? null, blocking: !!this.rules.block,
      blockFacing: this.rules.block?.facing ?? null, blockRemaining: Math.max(0, (this.rules.block?.until ?? 0) - now),
      blockCooldown: Math.max(0, this.rules.blockReadyAt - now), staggerRemaining: Math.max(0, this.rules.staggerUntil - now),
      cooldowns: Object.fromEntries(Object.keys(ATTACKS).map(name => [name, Math.max(0, (this.rules.readyAt[name] ?? 0) - now)])) };
  }
}
