import { playFacing, pixelforgeBoxes } from '../../export/pixelforge.js';
import { ATTACKS, BLOCK, BODY, DIRECTIONS, DODGE, MASH, CombatRules, aimFacing, attackAnim, directionTo, attackTargets, extendPath, pushSpeed } from './rules.js';
import { GrappleHold, grapplePosition } from './grapple.js';
import { showGrappleOverlay } from './grappleVisuals.js';
import { updateBellowVisuals } from './bellowVisuals.js';
import { dodgeTrail } from './dodge.js';
import { touch } from './touch.js';
import { levelWalls } from './walls.js';
import { ALL_KEYS, layout } from '../controls.js';

// Everything a held or stunned fighter can press to mash out (MASH): any arrow or button.
const MASH_KEYS = ['left', 'right', 'up', 'down', 'punch', 'kick', 'headbutt', 'block', 'dodge', 'takedown', 'bellow', 'grapple'];

// Extend the existing Pixel Forge movement controller; keep its physics, input overrides and playtest API.
// onHit(target, move, result) runs for every hit this fighter lands, and onWhiff(sprite, move, facing) for
// a swing whose active frames ended without touching anyone: hitFeel.js makes both felt. `others` are
// fighters the host judges (online players): they can't be hit from here, but a swing that visibly
// reaches one isn't a whiff, and onPredict(other, move) runs the moment it does, so the hit can be felt
// now instead of a round trip later (the host's answer only brings the damage). The sprite emits
// 'combat-dud' (move) when a move is pressed while it's still cooling down.
// Controls (the "controls that feel effortless" pass): a press made a moment early is buffered (rules.js
// BUFFER_MS) and fires the first frame the fighter is free; a tap with no arrow held swings at the nearest
// opponent (aimFacing), and a touch button dragged aims (touch.aimed); the dodge hops away, untouchable for a
// moment, emitting 'combat-dodge' (its facing); and a held or stunned fighter's presses mash out, emitting
// 'combat-mash' (the host shortens the hold or stun online; offline it happens here). Keys come from the
// layout picked in the menu (controls.js). Set `online` while the host judges this fighter.
export class TitusCombat {
  constructor(scene, sprite, { health, targets = () => [], onHit = () => {}, onWhiff = () => {}, others = () => [], onPredict = () => {} } = {}) {
    this.scene = scene;
    this.sprite = sprite;
    this.rules = new CombatRules(health, sprite.texture.key);
    this.targets = targets;
    this.onHit = onHit;
    this.onWhiff = onWhiff;
    this.others = others;
    this.onPredict = onPredict;
    this.swing = null;   // the current attack: {live} once its active frames start, {landed} once it touches someone
    this.push = null;    // a knockback slide in progress
    this.struck = new Set();
    this.path = [];
    this.punches = 0;   // alternates hands facing up and down
    this.walls = levelWalls(scene.levelName);   // nobody is hit through a wall
    sprite.combat = this;
    const c = sprite.controller;
    this.controller = c;
    const read = c.readInput.bind(c), move = c.updateTopdown.bind(c);
    const keys = scene.input.keyboard.addKeys(ALL_KEYS.join(','));
    // The HUD's touch controls (touch.js) count as keys: a held touch button is a held key.
    c.readInput = () => {
      const input = read();
      if (c.override) {
        const o = c.override;
        return { ...input, attack: false, takedown: !!o.takedown, bellow: !!o.bellow, grapple: !!o.grapple, punch: !!o.punch,
          kick: !!o.kick, headbutt: !!o.headbutt, block: !!o.block, dodge: !!o.dodge };
      }
      // Only the layout's own keys: the generated helper's default WASD bindings don't move you in the arrow layout.
      const L = layout(), down = (k) => !!keys[k]?.isDown, special = down(L.super) || touch.takedown, char = sprite.texture.key;
      return { ...input, attack: false,
        left: L.move.left.some(down) || touch.left, right: L.move.right.some(down) || touch.right,
        up: L.move.up.some(down) || touch.up, down: L.move.down.some(down) || touch.down,
        takedown: char === 'titus' && special, bellow: char === 'james' && special, grapple: char === 'mason' && special,
        punch: down(L.punch) || touch.punch, kick: down(L.kick) || touch.kick, headbutt: down(L.headbutt) || touch.headbutt,
        block: down(L.block) || touch.block, dodge: down(L.dodge) || touch.dodge };
    };
    const update = c.update.bind(c);
    c.update = (time) => {
      // A hit's freeze (hitFeel.js) holds the fighter still: no movement, the pose paused. A press still buffers.
      if (sprite.hitFreeze) { this.rules.watch(time, c.readInput()); return; }
      this.updatePush(time);
      this.updateGrapple();
      if (time < this.rules.stunUntil) {
        const input = c.readInput();
        this.mash(time, input);
        this.rules.watch(time, input);
        if (time >= this.rules.stunUntil) return;   // shaken off this very frame
        this.rules.attack = null;
        if (this.rules.block) this.rules.endBlock(time);
        c.busy = null;
        if (this.networkStunPosition) sprite.body.reset(this.networkStunPosition.x, this.networkStunPosition.y);
        sprite.body.setVelocity(0, 0);
        sprite.setDepth(sprite.y);
        playFacing(sprite, 'stunned', this.rules.health.stunFacing ?? c.facing);
        return;
      }
      if (this.networkHeld) sprite.body.reset(this.networkHeld.x, this.networkHeld.y);
      if (this.rules.heldBy) {
        const input = c.readInput();
        this.mash(time, input);
        this.rules.watch(time, input);
        c.busy = null;
        c.facing = this.rules.heldBy.attack.facing;
        sprite.body.setVelocity(0, 0);
        sprite.setDepth(sprite.y);
        playFacing(sprite, 'grappled', c.facing);
        return;
      }
      if (this.networkGrapple) sprite.body.reset(this.networkGrapple.x, this.networkGrapple.y);
      if (time < (c.stunnedUntil ?? 0)) {
        // A press during the flinch or knockback buffers; a key held through it never fires on its own.
        const input = c.readInput();
        this.rules.watch(time, input);
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
      const wasDodging = this.rules.dodge;
      this.rules.update(now, input, c.facing);
      if (this.rules.dud) sprite.emit('combat-dud', this.rules.dud);
      if (!wasBlocking && this.rules.block) sprite.emit('combat-block', this.rules.block.facing);
      if (wasBlocking && !this.rules.block) sprite.emit('combat-release');
      if (this.rules.dodge && this.rules.dodge !== wasDodging) {
        dodgeTrail(scene, sprite, DODGE.duration);
        sprite.emit('combat-dodge', this.rules.dodge.facing);
      }
      if (!old && this.rules.attack) {
        // Where the swing goes: a touch button dragged to aim; else the arrows held; else, for a tap, the
        // nearest opponent (aimFacing). The chosen facing is what goes to the host.
        const spec = ATTACKS[this.rules.attack.name], button = spec.character ? 'takedown' : this.rules.attack.name;
        const aimed = touch.aimed?.move === button ? touch.aimed.facing : null;
        if (touch.aimed?.move === button) touch.aimed = null;
        const dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
        const held = [dx > 0 ? 'right' : dx < 0 ? 'left' : null, dy > 0 ? 'down' : dy < 0 ? 'up' : null].filter(Boolean);
        const aim = aimed ?? aimFacing(sprite, this.opponents(), spec, held, this.walls);
        if (aim) { this.rules.attack.facing = aim; c.facing = aim; }
        this.struck.clear();
        this.path = [{ x: sprite.x, y: sprite.y }];
        this.swing = { live: false, landed: false, predicted: new Set() };
        const { name, facing } = this.rules.attack;
        c.busy = attackAnim(sprite.texture.key, name, facing, name === 'punch' ? this.punches++ : 0, key => scene.anims.exists(key));
        sprite.setFlipX(facing === 'left').play(c.busy, true);
        sprite.emit('pixelforge-attack', sprite);
      }
      const action = this.rules.attack ?? this.rules.block;
      if (this.rules.health.value <= 0) { sprite.body.setVelocity(0, 0); return; }
      if (this.rules.dodge) {
        // The hop: its whole distance at an even speed, in the walk pose. Walls stop it like anything else.
        const d = this.rules.dodge, speed = DODGE.distance * 1000 / DODGE.duration;
        c.busy = null;
        sprite.body.setVelocity(d.dx * speed, d.dy * speed);
        playFacing(sprite, 'walk', c.facing);
        sprite.setDepth(sprite.y);
        return;
      }
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
        // Standing still while a thumb aims a touch move: turn to face where it will go.
        const still = !input.left && !input.right && !input.up && !input.down;
        if (still && touch.aim?.facing) c.facing = touch.aim.facing;
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
      this.cancelGrapple();
      scene.events.off('postupdate', hit);
      sprite.off('animationcomplete', complete);
      sprite.off('animationupdate', hit);
    });
  }
  // Everyone this fighter could swing at: the hittable targets here and the online players it can see.
  opponents() {
    const alive = t => t.active && t !== this.sprite && t.visible !== false && (t.combat ? t.combat.rules.health.value > 0 : t.alive !== false);
    return [...this.targets(), ...this.others()].filter(alive);
  }
  // Held or stunned: any fresh press (an arrow or a button) mashes. Online the host does the shortening; offline
  // it happens here, and the flinch that holds a stun shortens with it.
  mash(time, input) {
    const fresh = MASH_KEYS.some(k => input[k] && !this.rules.previous[k]);
    if (!fresh || time < (this.mashReady ?? 0)) return;
    this.mashReady = time + MASH.gap;
    this.sprite.emit('combat-mash');
    if (this.online) return;
    if (this.rules.heldBy?.mash) this.rules.heldBy.mash(time);
    else if (this.rules.shakeOff(time)) this.controller.stunnedUntil = Math.min(this.controller.stunnedUntil ?? 0, this.rules.staggerUntil);
  }
  checkHits() {
    this.updateGrapple();
    const heldFacing = this.grapple?.hold.attack.facing ?? this.networkGrapple?.facing;
    showGrappleOverlay(this.sprite, heldFacing, !!heldFacing);
    const attack = this.rules.attack;
    updateBellowVisuals(this.scene, this.sprite, attack, Math.max(0, this.rules.stunUntil-this.scene.time.now));
    if (!attack || !this.sprite.active || this.rules.health.value <= 0) { this.swing = null; return; }
    // Track the lunge from the wind-up on, so the strike covers everyone the swing carried us over.
    extendPath(this.path, this.sprite);
    const spec = this.rules.attackSpec(attack.name), elapsed = this.scene.time.now - attack.start;
    const active = spec.radial ? elapsed >= spec.frames[0] && elapsed < spec.frames[0] + spec.frames[1]
      : pixelforgeBoxes(this.sprite, 'hit').length > 0;
    if (!active) {
      // The active frames just ended: a swing that touched nobody whiffs.
      if (this.swing?.live) {
        if (!this.swing.landed) this.onWhiff(this.sprite, attack.name, attack.facing);
        this.swing = null;
      }
      return;
    }
    if (this.swing) {
      this.swing.live = true;
      // Online opponents this swing visibly reaches, as this screen draws them: each one's hit is felt now.
      const seen = this.others().filter(o => o.active && o.visible !== false && o.alive !== false && !this.swing.predicted.has(o));
      for (const other of attackTargets(this.sprite, seen, attack.facing, spec, this.path, this.walls)) {
        if (this.swing.predicted.size >= (spec.maxTargets ?? Infinity)) break;
        this.swing.predicted.add(other);
        this.swing.landed = true;
        if (!spec.hold) this.onPredict(other, attack.name);   // a Grapple's damage waits for the hold to finish
      }
    }
    const now = this.scene.time.now;
    const grabbable = target => !target.grappledBy && !target.combat?.rules.heldBy && now >= (target.combat?.rules.grabImmuneUntil ?? target.grabImmuneUntil ?? 0);
    const candidates = this.targets().filter(target => target.active && target !== this.sprite && !this.struck.has(target) && (!spec.hold || grabbable(target)) && (target.combat ? target.combat.rules.health.value > 0 : true));
    for (const target of attackTargets(this.sprite, candidates, attack.facing, spec, this.path, this.walls)) {
      // In this three-quarter view a head and boot have different drawn heights. Combat range
      // lives on the ground plane so rotating the same move never changes its reach.
      // The exported art still determines the active frames, never the wind-up or recovery.
      if (this.struck.size >= (spec.maxTargets ?? Infinity)) break;
      this.struck.add(target);
      if (this.swing) this.swing.landed = true;
      if (spec.hold && !target.combat?.rules.blocks(directionTo(this.sprite.x-target.x, this.sprite.y-target.y), this.scene.time.now)) {
        const rules = target.combat?.rules ?? (target.actor ? { health: { get value() { return target.actor.hp; } } } : null);
        if (rules) {
          const hold = new GrappleHold(this.rules, rules, attack, this.scene.time.now);
          this.grapple = { hold, target, anchor: { x: this.sprite.x, y: this.sprite.y } };
          target.grappledBy = this;
          this.updateGrapple();
          continue;
        }
      }
      const result = target.combat ? target.combat.receive(this.sprite, spec) : target.actor?.hit(this.sprite, spec);
      this.onHit(target, attack.name, result);
      this.sprite.emit('pixelforge-hit', target);
    }
  }
  cancelGrapple() {
    if (!this.grapple) return;
    const { hold, target } = this.grapple, now = this.scene.time.now;
    hold.cancel(now);
    target.grabImmuneUntil = now + MASH.regrab;
    if (target.grappledBy === this) delete target.grappledBy;
    // Mashed out early: skip the rest of the choke, straight to the recovery.
    const frames = ATTACKS.grapple.frames, total = frames.reduce((a, b) => a + b, 0);
    if (hold.mashed && this.rules.attack?.name === 'grapple' && this.sprite.anims.getProgress() < (total - frames[3]) / total) {
      this.sprite.anims.setProgress((total - frames[3]) / total);
    }
    if (target.combat) {
      target.combat.controller.busy = null;
      if (target.active && target.combat.rules.health.value > 0) playFacing(target, 'idle', target.combat.controller.facing);
    }
    this.grapple = null;
  }
  updateGrapple() {
    if (!this.grapple) return;
    const { hold, target, anchor } = this.grapple;
    if (!target.active || !this.sprite.active) { this.cancelGrapple(); return; }
    const state = hold.update(this.scene.time.now);
    if (state !== 'holding') {
      this.cancelGrapple();
      if (state === 'damage') {
        const spec = this.rules.attackSpec('grapple');
        const result = target.combat ? target.combat.receive(this.sprite, spec) : target.actor?.hit(this.sprite, spec);
        this.onHit(target, 'grapple', result);
        this.sprite.emit('pixelforge-hit', target);
      }
      return;
    }
    this.sprite.body.reset(anchor.x, anchor.y);
    const p = grapplePosition(anchor, hold.attack.facing);
    target.body.reset(p.x, p.y);
    if (target.combat) {
      target.combat.controller.busy = null;
      target.combat.controller.facing = hold.attack.facing;
      playFacing(target, 'grappled', hold.attack.facing);
    }
    target.setDepth(p.y);
    this.sprite.setDepth(anchor.y - 0.5);
  }
  drawReach(graphics) {
    const attack = this.rules.attack;
    if (!attack || !pixelforgeBoxes(this.sprite, 'hit').length) return;
    // Draw the zone a body centre actually hits in: the spec's rect credited BODY on every side,
    // swept over the lunge so far.
    if (ATTACKS[attack.name].radial) { graphics.lineStyle(1,0xffcc77).strokeCircle(this.sprite.x,this.sprite.y,ATTACKS[attack.name].reach); return; }
    const spec=ATTACKS[attack.name], reach=spec.reach+BODY, width=(spec.width??18)+BODY, [fx,fy]=DIRECTIONS[attack.facing];
    const corners=[...this.path,this.sprite].flatMap(({x,y})=>[[x-fx*BODY,y-fy*BODY],[x+fx*reach,y+fy*reach]])
      .flatMap(([x,y])=>[[x+fy*width,y+fx*width],[x-fy*width,y-fx*width]]);
    const xs=corners.map(c=>c[0]), ys=corners.map(c=>c[1]), x=Math.min(...xs), y=Math.min(...ys);
    graphics.lineStyle(1,0xff5577).strokeRect(x,y,Math.max(...xs)-x,Math.max(...ys)-y);
  }
  receive(from, spec) {
    const result = this.rules.receive(spec, directionTo(from.x - this.sprite.x, from.y - this.sprite.y), this.scene.time.now);
    // A perfect block staggers whoever swung.
    if (result.perfect) {
      if (from.combat) from.combat.applyHit(this.sprite, from.combat.rules.parried(this.scene.time.now));
      else from.actor?.parried?.(this.sprite);
    }
    return this.applyHit(from, result);
  }
  // Network damage is already resolved by the host; apply its pose/physics result once. The flash, freeze
  // and spark are hitFeel.js's, run by whoever calls this. A parried swing (result.parried) has no damage
  // but staggers all the same.
  applyHit(from, result) {
    if (!result.damage && !result.parried) return result;
    const incoming = directionTo(from.x-this.sprite.x, from.y-this.sprite.y);
    if (result.stun) {
      this.rules.health.stunUntil = Math.max(this.rules.stunUntil, this.scene.time.now + result.stun);
      this.rules.health.healingBlockedFor = Math.max(this.rules.health.healingBlockedFor ?? 0, result.stun);
      this.rules.health.stunFacing = incoming ?? this.controller.facing;
    }
    if (result.stagger) {
      this.rules.attack = null;
      this.cancelGrapple();
      this.sprite.grappledBy?.cancelGrapple();
      this.rules.staggerUntil = Math.max(this.rules.staggerUntil, this.scene.time.now + result.stagger);
      if (this.rules.block) this.rules.endBlock(this.scene.time.now);
      this.controller.busy = null;
      if (result.knockdown) {
        this.rules.knockedDownUntil = this.scene.time.now + result.knockdown;
        this.rules.knockdownFacing = result.knockdownFacing ?? directionTo(from.x-this.sprite.x, from.y-this.sprite.y) ?? this.controller.facing;
        this.controller.facing = this.rules.knockdownFacing;
        playFacing(this.sprite, 'knockdown', this.controller.facing);
      } else if (result.stun) {
        // Into the stunned pose now, so the hit's freeze holds it.
        playFacing(this.sprite, 'stunned', this.rules.health.stunFacing);
      } else if (this.scene.time.now >= this.rules.knockedDownUntil) {
        // The flinch: turn to the hit and play the hurt pose (head snapped back, arms out) for the stagger.
        if (incoming) this.controller.facing = incoming;
        const hurt = this.scene.anims.exists(`${this.sprite.texture.key}_hurt_${this.controller.facing === 'left' || this.controller.facing === 'right' ? 'side' : this.controller.facing}`);
        playFacing(this.sprite, hurt ? 'hurt' : 'idle', this.controller.facing);
      }
      this.controller.stun(result.stagger);
    }
    // Slide away from the hit once the freeze lets go: fast, then easing to a stop. A stunned fighter stays put.
    const speed = pushSpeed(result.knockback ?? 0, result.slide ?? 0);
    if (speed && this.scene.time.now >= this.rules.stunUntil) {
      const dx = this.sprite.x - from.x, dy = this.sprite.y - from.y, length = Math.hypot(dx, dy) || 1;
      this.push = { vx: dx / length * speed, vy: dy / length * speed, slide: result.slide, start: null };
    }
    return result;
  }
  // The knockback slide, a frame at a time. It starts on the first frame after the freeze, and the
  // controller lets go of the body until it ends, so a held arrow can't steer out of it.
  updatePush(time) {
    const p = this.push;
    if (!p) return;
    p.start ??= time;
    // The speed at the middle of the coming frame (as long as the last one), so it covers exactly its distance.
    const frame = time - (p.last ?? time - 1000 / 60);
    p.last = time;
    if (time - p.start >= p.slide || !this.sprite.active) { this.push = null; if (this.sprite.active) this.sprite.body.setVelocity(0, 0); return; }
    const left = Math.max(0, 1 - (time - p.start + frame / 2) / p.slide);
    this.controller.stunnedUntil = Math.max(this.controller.stunnedUntil ?? 0, p.start + p.slide);
    this.sprite.body.setVelocity(p.vx * left, p.vy * left);
  }
  snapshot() {
    const now = this.scene.time.now;
    return { held: !!this.rules.heldBy, holding: !!this.grapple || !!this.networkGrapple, attack: this.rules.attack?.name ?? null, blocking: !!this.rules.block,
      blockFacing: this.rules.block?.facing ?? null, blockRemaining: Math.max(0, (this.rules.block?.until ?? 0) - now),
      blockCooldown: Math.max(0, this.rules.blockReadyAt - now), staggerRemaining: Math.max(0, this.rules.staggerUntil - now),
      stunRemaining: Math.max(0, this.rules.stunUntil-now), healingBlockedFor: this.rules.health.healingBlockedFor ?? 0,
      knockdownRemaining: Math.max(0, this.rules.knockedDownUntil - now),
      dodging: !!this.rules.dodge, buffered: this.rules.buffered?.name ?? null,
      cooldowns: Object.fromEntries([...Object.keys(ATTACKS), 'dodge'].map(name => [name, Math.max(0, (this.rules.readyAt[name] ?? 0) - now)])) };
  }
}
