import { playFacing, pixelforgeBoxes } from '../../export/pixelforge.js';
import { ATTACKS, BLOCK, BODY, DIRECTIONS, CombatRules, directionTo, attackTargets, extendPath } from './rules.js';
import { touch } from './touch.js';

// Extend the existing Pixel Forge movement controller; keep its physics, input overrides and playtest API.
export class TitusCombat {
  constructor(scene, sprite, { health, targets = () => [], onHit = () => {} } = {}) {
    this.scene = scene;
    this.sprite = sprite;
    this.rules = new CombatRules(health, sprite.texture.key);
    this.targets = targets;
    this.onHit = onHit;
    this.struck = new Set();
    this.path = [];
    sprite.combat = this;
    const c = sprite.controller;
    this.controller = c;
    const read = c.readInput.bind(c), move = c.updateTopdown.bind(c);
    const keys = scene.input.keyboard.addKeys('C,X,Z,V,S');
    // The HUD's touch controls (touch.js) count as keys: a held touch button is a held key.
    c.readInput = () => {
      const input = read();
      return { ...input, attack: false,
        // Keep movement independent of the generated helper's default WASD bindings.
        left: c.override ? input.left : c.keys.LEFT.isDown || touch.left,
        right: c.override ? input.right : c.keys.RIGHT.isDown || touch.right,
        up: c.override ? input.up : c.keys.UP.isDown || touch.up,
        down: c.override ? input.down : c.keys.DOWN.isDown || touch.down,
        takedown: c.override ? !!c.override.takedown : keys.S.isDown || touch.takedown,
        punch: c.override ? !!c.override.punch : keys.C.isDown || touch.punch,
        kick: c.override ? !!c.override.kick : keys.X.isDown || touch.kick,
        headbutt: c.override ? !!c.override.headbutt : keys.Z.isDown || touch.headbutt,
        block: c.override ? !!c.override.block : keys.V.isDown || touch.block };
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
        // Facing assist: a swing that would whiff turns toward an opponent who IS in range on
        // another side, so "roughly facing them" is enough. The chosen facing is what goes to the host.
        const spec = ATTACKS[this.rules.attack.name];
        const live = this.targets().filter(t => t.active && t !== sprite && (t.combat ? t.combat.rules.health.value > 0 : true));
        if (!attackTargets(sprite, live, this.rules.attack.facing, spec).length) {
          let best = null;
          for (const dir of Object.keys(DIRECTIONS)) {
            const [t] = dir === this.rules.attack.facing ? [] : attackTargets(sprite, live, dir, spec);
            if (t) { const d = Math.hypot(t.x - sprite.x, t.y - sprite.y); if (!best || d < best.d) best = { dir, d }; }
          }
          if (best) { this.rules.attack.facing = best.dir; c.facing = best.dir; }
        }
        this.struck.clear();
        this.path = [{ x: sprite.x, y: sprite.y }];
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
        // Walking into an attack keeps most of its momentum, and the swing itself lunges toward
        // its facing through windup+active, so a moving target can't simply outwalk the hit.
        const spec = this.rules.block ? null : ATTACKS[action.name];
        const speed = c.opts.speed * (this.rules.block ? BLOCK.speed : (spec.speed ?? 0.8));
        let vx = dx / length * speed, vy = dy / length * speed;
        if (spec?.lunge && now <= (action.start ?? 0) + spec.frames[0] + spec.frames[1]) {
          const [fx, fy] = DIRECTIONS[action.facing];
          vx += fx * spec.lunge; vy += fy * spec.lunge;
        }
        sprite.body.setVelocity(vx, vy);
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
    // Track the lunge from the wind-up on, so the strike covers everyone the swing carried us over.
    extendPath(this.path, this.sprite);
    const hits = pixelforgeBoxes(this.sprite, 'hit');
    if (!hits.length) return;
    const spec = this.rules.attackSpec(attack.name);
    const candidates = this.targets().filter(target => target.active && target !== this.sprite && !this.struck.has(target) && (target.combat ? target.combat.rules.health.value > 0 : true));
    for (const target of attackTargets(this.sprite, candidates, attack.facing, spec, this.path)) {
      // In this three-quarter view a head and boot have different drawn heights. Combat range
      // lives on the ground plane so rotating the same move never changes its reach.
      // The exported art still determines the active frames, never the wind-up or recovery.
      if (this.struck.size >= (spec.maxTargets ?? Infinity)) break;
      this.struck.add(target);
      const result = target.combat ? target.combat.receive(this.sprite, spec) : target.actor?.hit(this.sprite, spec);
      this.onHit(target, attack.name, result);
      this.sprite.emit('pixelforge-hit', target);
    }
  }
  drawReach(graphics) {
    const attack = this.rules.attack;
    if (!attack || !pixelforgeBoxes(this.sprite, 'hit').length) return;
    // Draw the zone a body centre actually hits in: the spec's rect credited BODY on every side,
    // swept over the lunge so far.
    const spec=ATTACKS[attack.name], reach=spec.reach+BODY, width=(spec.width??18)+BODY, [fx,fy]=DIRECTIONS[attack.facing];
    const corners=[...this.path,this.sprite].flatMap(({x,y})=>[[x-fx*BODY,y-fy*BODY],[x+fx*reach,y+fy*reach]])
      .flatMap(([x,y])=>[[x+fy*width,y+fx*width],[x-fy*width,y-fx*width]]);
    const xs=corners.map(c=>c[0]), ys=corners.map(c=>c[1]), x=Math.min(...xs), y=Math.min(...ys);
    graphics.lineStyle(1,0xff5577).strokeRect(x,y,Math.max(...xs)-x,Math.max(...ys)-y);
  }
  receive(from, spec) {
    const result = this.rules.receive(spec, directionTo(from.x - this.sprite.x, from.y - this.sprite.y), this.scene.time.now);
    return this.applyHit(from, result);
  }
  // Network damage is already resolved by the host; apply its visual/physics result once.
  applyHit(from, result) {
    if (!result.damage) return result;
    if (!result.knockdown) this.scene.feel?.flash(this.sprite, 90, result.blocked ? 0x77bbff : 0xffffff);
    if (result.stagger) {
      this.rules.attack = null;
      this.rules.staggerUntil = Math.max(this.rules.staggerUntil, this.scene.time.now + result.stagger);
      if (this.rules.block) this.rules.endBlock(this.scene.time.now);
      this.controller.busy = null;
      if (result.knockdown) {
        this.rules.knockedDownUntil = this.scene.time.now + result.knockdown;
        this.rules.knockdownFacing = result.knockdownFacing ?? directionTo(from.x-this.sprite.x, from.y-this.sprite.y) ?? this.controller.facing;
        this.controller.facing = this.rules.knockdownFacing;
        playFacing(this.sprite, 'knockdown', this.controller.facing);
      } else if (this.scene.time.now >= this.rules.knockedDownUntil) playFacing(this.sprite, 'idle', this.controller.facing);
    }
    // A brief push for light attacks; headbutt holds the victim in recovery longer.
    const pushTime = result.knockdown ? 80 : (result.stagger || 80);
    this.controller.stun(result.stagger || pushTime);
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
      knockdownRemaining: Math.max(0, this.rules.knockedDownUntil - now),
      cooldowns: Object.fromEntries(Object.keys(ATTACKS).map(name => [name, Math.max(0, (this.rules.readyAt[name] ?? 0) - now)])) };
  }
}
