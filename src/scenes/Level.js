import { ShowerEffects } from '../showerEffects.js';
import Phaser from 'phaser';
import { pixelforgeLevel, enablePixelforgeHits, drawPixelforgeBoxes, installPixelforgePlay, pixelforgeFeel, pixelforgeDialog,
         spawnPixelforgeFx } from '../../export/pixelforge.js';
import { state, bus, damage, addCoins, addItem, reset, playerHealth } from '../game.js';
import { TitusCombat } from '../combat/TitusCombat.js';
import { ATTACKS, BLOCK } from '../combat/rules.js';
import { releaseTouch } from '../combat/touch.js';
import { showHud } from './Hud.js';
import { Walker } from '../objects/Walker.js';
import { HeadBar, headroom } from '../objects/HeadBar.js';
import { net, WORLD_ROOM } from '../net/session.js';
import { RemotePlayers } from '../net/remotes.js';
import { FIGHTER_IDS, fighter } from '../fighters.js';
import { enableCornerSlide } from '../cornerSlide.js';
import { RoomShadows } from '../roomShadows.js';
import { hud, actions } from '../ui/bridge.ts';
import { showLobby, mountHud } from '../ui/mount.tsx';
import { currentSession } from '../ui/session.ts';

// Object type (a level object's "type") → the class that gives it behaviour. Add yours here.
const TYPES = { enemy: Walker };

// One scene plays every level: pixelforgeLevel builds it from export/levels/<name>.json (map, props,
// sprites, the player at the spawn, the camera), and this scene adds the rules:
//   doors ("type": "door", "to": a level, "spawn": where to arrive) restart it in the next level;
//   items ("type": "item" or "coin") are picked up on touch: props.loot "coin" (or a coin) adds coins,
//     any other loot (or the item's name) goes into the inventory;
//   chests ("type": "chest") open on touch and give their props.loot;
//   anything with props.text (a sign, an NPC, a trigger zone) opens a dialog box on touch, once per visit;
//   TYPES: sprites with those types get a behaviour object (enemies hurt on touch, die to attacks).
// Hits land with this.feel (pixelforgeFeel): a hit stop, a small shake, a flash, knockback, and the
// 'fx_hit' effect when the art has one.
// Multiplayer (src/net/): the other players in this level are drawn from `net`, and this player's state is
// sent to them every frame.
// The HUD is React (src/ui/Hud.tsx) over the canvas: this scene tells it, through src/ui/bridge.ts, who's
// online and when Block and the Super come back, and gives its menu Change fighter and Leave game.
// Health is a bar over every fighter's head (objects/HeadBar.js), drawn here in the world.
// Rooms (roomShadows.js) are dark from the hall, with whoever's inside hidden; from a room you see out.
// Dev only: B toggles the hit/hurt boxes, and window.pixelforgePlay drives the game for `pixelforge play`.
export class Level extends Phaser.Scene {
  constructor() { super('level'); }

  init(data) {
    this.levelName = data.level;
    this.spawnName = data.spawn;
    const requested = data.character ?? this.character ?? new URLSearchParams(location.search).get('character');
    this.character = FIGHTER_IDS.includes(requested) ? requested : FIGHTER_IDS[0];
    this.playerPosition = data.playerPosition;
  }

  create() {
    this.combat = null;
    this.inLobby = false;
    // the world is drawn at 2x (characters ~48px tall), so walk twice pixelforge's default 70 px/s
    const level = (this.level = pixelforgeLevel(this, this.levelName, {
      spawn: this.spawnName, player: this.character,
      playerOptions: { speed: fighter(this.character).speed },
    }));
    const player = level.player;
    if (player && this.playerPosition) player.body.reset(...this.playerPosition);
    this.rooms = new RoomShadows(this, level, player ? [player.x, player.y] : undefined);
    this.showers = new ShowerEffects(this);
    this.feel = pixelforgeFeel(this);
    this.hud = showHud(this);
    mountHud();
    this.superMove = superMove(this.character);
    hud.set({ visible: true, character: this.character, shield: { phase: 'ready' },
              super: { ...this.superMove, endsAt: 0 } });
    actions.changeFighter = () => this.openLobby({ session: currentSession() });
    actions.leave = () => { net.end('left'); this.openLobby({}); };
    this.events.once('shutdown', () => { hud.set({ visible: false }); releaseTouch(); });
    this.selfBar = player ? new HeadBar(this) : null;
    this.actors = [];
    for (const s of level.sprites) {
      const Type = TYPES[s.pixelforgeObject?.type];
      if (Type) this.actors.push((s.actor = new Type(this, s, level)));
    }
    for (const a of this.actors) if (a.hp) a.bar = new HeadBar(this);
    this.events.on('postupdate', this.placeBars, this);
    this.events.once('shutdown', () => this.events.off('postupdate', this.placeBars, this));
    this.pickups = level.props.filter((p) => ['item', 'coin'].includes(p.pixelforgeObject?.type));
    for (const p of this.pickups) if (p.body) p.body.enable = false;   // walk through them, don't bump into them
    this.chests = level.props.filter((p) => p.pixelforgeObject?.type === 'chest');
    this.talkers = [...level.props, ...level.sprites].filter((s) => s.pixelforgeObject?.props?.text);

    const on = (emitter, event, fn) => { emitter.on(event, fn); this.events.once('shutdown', () => emitter.off(event, fn)); };
    on(this.events, 'pixelforge-trigger', (obj) => this.trigger(obj));
    on(bus, 'dead', () => {
      if (!net.active) this.time.delayedCall(400, () => { reset(); this.scene.restart({ level: this.levelName, spawn: this.spawnName }); });
    });

    this.remotes = new RemotePlayers(this, net);
    const showRoom = () => hud.set({ net: { active: net.active, world: net.room === WORLD_ROOM, room: net.room, count: net.count } });
    showRoom();
    on(net, 'players', showRoom);
    on(net, 'ended', (reason) => {
      if (this.combat) {
        this.combat.networkStunPosition = null;
        this.combat.networkHeld = null;
        this.combat.networkGrapple = null;
        if (!player?.grappledBy) this.combat.rules.heldBy = null;
      }
      if (reason !== 'left') this.toast(reason);
    });

    if (player) {
      const hittable = () => this.actors.filter((a) => a.hit && a.sprite.active).map((a) => a.sprite);
      if (FIGHTER_IDS.includes(this.character)) {
        this.combat = new TitusCombat(this, player, { health: playerHealth, targets: hittable });
        on(player, 'pixelforge-attack', () => {
          const attack = this.combat.rules.attack;
          if (attack) net.combatCommand(attack.name, attack.facing);
        });
        on(player, 'combat-block', (facing) => net.combatCommand('block', facing));
        on(player, 'combat-release', () => net.combatCommand('release'));
        const life = net.combatState.fighters[net.id]?.life ?? 0;
        on(net, 'combat', ({fighters, hits}) => {
          const self = fighters[net.id];
          if (!self || !player.active || this.inLobby) return;
          this.combat.rules.readyAt.bellow = this.time.now + (self.bellowCooldown ?? 0);
          this.combat.networkStunPosition = self.stunPosition;
          playerHealth.stunUntil = this.time.now + (self.stun ?? 0);
          playerHealth.stunFacing = self.stunFacing;
          playerHealth.healingBlockedFor = self.healingBlockedFor ?? 0;
          if (self.stun) { this.combat.rules.attack = null; this.combat.controller.busy = null; }
          this.combat.rules.readyAt.grapple = this.time.now + (self.grappleCooldown ?? 0);
          this.combat.networkHeld = self.held;
          this.combat.networkGrapple = self.grapple;
          this.combat.rules.heldBy = self.held ? { attack: { facing: self.held.facing } } : null;
          if (self.held) { this.combat.rules.attack = null; this.combat.controller.busy = null; }
          this.combat.rules.readyAt.takedown = this.time.now + (self.takedownCooldown ?? 0);
          if (self.life !== life) {
            reset();
            this.scene.restart({level:this.levelName,spawn:this.spawnName,character:this.character});
            return;
          }
          if (playerHealth.value !== self.health) {
            playerHealth.value = self.health;
            playerHealth.onChange(self.health);
          }
          for (const hit of hits) if (hit.target === net.id) {
            this.combat.applyHit(hit.from ?? {x:player.x-1,y:player.y}, hit);
          }
        });
      } else enablePixelforgeHits(this, player, hittable, (target) => {
        this.feel.hitStop(50).shake(80, 1);
        if (this.textures.exists('fx_hit')) spawnPixelforgeFx(this, (player.x + target.x) / 2, target.body.center.y, 'fx_hit');
        target.actor.hit(player);
      });
      this.physics.add.overlap(player, this.actors.map((a) => a.sprite), (_, enemy) => {
        if (enemy.body.enable && !enemy.grappledBy) this.hurt(enemy);
      });
      // clipping a corner by a few pixels slides you around it instead of stopping you
      if (level.info?.view !== 'side') enableCornerSlide(player, { layers: Object.values(level.layers), props: level.props });
    }

    if (import.meta.env.DEV) {
      installPixelforgePlay(this, level, { extra: () => ({ health: state.health, coins: state.coins, inventory: [...state.inventory], combat: player?.combat?.snapshot() }) });
      this.debug = this.add.graphics().setDepth(2e5);
      this.input.keyboard.on('keydown-B', () => { this.showBoxes = !this.showBoxes; });
    }
  }

  update(time, delta) {
    if (!net.active) playerHealth.update(delta);
    this.pushHud();
    for (const a of this.actors) a.update?.(time);
    const p = this.level.player;
    if (net.active && p?.active) {
      net.setLocal({ name: net.name, char: this.character, level: this.levelName, x: Math.round(p.x * 10) / 10,
                     y: Math.round(p.y * 10) / 10, anim: p.anims.currentAnim?.key ?? null, flip: p.flipX });
    }
    if (p?.active) this.rooms.update(p.x, p.y);
    this.remotes.update(delta);
    this.showers.update(time, delta);
    for (const a of this.actors) {
      if (!a.sprite.active) continue;
      const seen = this.rooms.canSee(a.sprite.x, a.sprite.y);
      a.sprite.setVisible(seen);
      a.bar?.setVisible(seen);
    }
    if (p?.active) {
      const body = new Phaser.Geom.Rectangle(p.body.x, p.body.y, p.body.width, p.body.height);
      for (const item of this.pickups) {
        if (item.active && Phaser.Geom.Intersects.RectangleToRectangle(body, item.getBounds())) this.collect(item);
      }
      Phaser.Geom.Rectangle.Inflate(body, 2, 2);   // chests are solid: touching is enough
      for (const chest of this.chests) {
        if (!chest.opened && Phaser.Geom.Intersects.RectangleToRectangle(body, chest.getBounds())) this.open(chest);
      }
      for (const s of this.talkers) {   // walking up to a sign reads it; step away and back to read it again
        const near = s.active && Phaser.Geom.Intersects.RectangleToRectangle(body, s.getBounds());
        if (near && !s.read) this.say(s.pixelforgeObject);
        s.read = near;
      }
    }
    if (this.debug) {
      this.debug.clear();
      if (this.showBoxes && p) {
        drawPixelforgeBoxes(this.debug, [p, ...this.level.sprites.filter((s) => s.active)]);
        p.combat?.drawReach(this.debug);
      }
    }
  }

  // Health bars over the player and the enemies. Run on postupdate: Arcade only moves a sprite to its body
  // there, after update(), so a bar placed in update() trailed a frame behind a walking fighter.
  placeBars(time, delta) {
    for (const a of this.actors) {
      if (!a.bar) continue;
      if (a.sprite.active) a.bar.update(a.hp / a.maxHp, a.sprite.x, a.sprite.y - headroom(this, a.sprite.texture.key), delta);
      else { a.bar.destroy(); a.bar = null; }
    }
    const p = this.level.player;
    if (p?.active) this.selfBar?.update(state.health / state.maxHealth, p.x, p.y - headroom(this, this.character), delta);
  }

  // A short message at the top of the screen (the game ended, the host left).
  toast(text) {
    hud.toast(text);
  }

  // Block and the Super, for the HUD's keycaps: sent when a cooldown starts or a block goes up or down,
  // as deadlines the HUD counts down by itself.
  pushHud() {
    const snap = this.combat?.snapshot();
    if (!snap) return;
    const now = performance.now();
    const shield = snap.blocking ? { phase: 'holding', endsAt: now + snap.blockRemaining, duration: BLOCK.duration }
      : snap.blockCooldown ? { phase: 'cooldown', endsAt: now + snap.blockCooldown, duration: BLOCK.cooldown }
      : { phase: 'ready' };
    const left = this.superMove.move ? snap.cooldowns[this.superMove.move] : 0;
    const special = { ...this.superMove, endsAt: left ? now + left : 0 };
    const shown = hud.get();
    const moved = (a, b) => a.phase !== b.phase || Math.abs((a.endsAt ?? 0) - (b.endsAt ?? 0)) > 120;
    if (moved(shown.shield, shield) || moved({ phase: 'cooldown', ...shown.super }, { phase: 'cooldown', ...special })) {
      hud.set({ shield, super: special });
    }
  }

  // The menu's Change fighter (with the game you're in) and Leave game (without one): the lobby opens over
  // the paused level. Back from the fighter pick resumes as you were; a new fighter in the same game takes
  // your place where you stood; a different game starts the level over.
  async openLobby({ session }) {
    const player = this.level.player;
    if (this.inLobby || !player) return;
    this.inLobby = true;
    const room = net.room, at = [player.x, player.y];
    hud.set({ visible: false });
    releaseTouch();
    net.setLocal(null);                          // the others stop seeing you while you choose
    this.input.keyboard.disableGlobalCapture();  // so the lobby's fields can take C, X, Z, V, S and the arrows
    this.scene.pause();
    const { character, cancelled } = await showLobby({ level: this.levelName, character: this.character, session });
    this.input.keyboard.enableGlobalCapture();
    this.input.keyboard.resetKeys();
    this.inLobby = false;
    this.scene.resume();
    if (cancelled) {
      hud.set({ visible: true });
      return;
    }
    const sameGame = !!session && net.room === room;
    if (sameGame) this.scene.restart({ level: this.levelName, spawn: this.spawnName, character, playerPosition: at });
    else {
      reset();
      this.scene.restart({ level: this.levelName, spawn: this.spawnName, character });
    }
  }

  trigger(obj) {
    if (obj.props?.text) this.say(obj);
    if (obj.type === 'door' && obj.to) {
      if (!this.cache.tilemap.exists(obj.to)) return console.warn(`door to '${obj.to}': no such level in export/`);
      this.time.delayedCall(0, () => this.scene.restart({ level: obj.to, spawn: obj.spawn }));
    }
  }

  give(loot) {
    if (!loot) return;
    if (loot === 'coin' || loot === 'coins') addCoins(1);
    else addItem(loot);
  }

  collect(item) {
    const o = item.pixelforgeObject;
    this.give(o.type === 'coin' ? 'coin' : o.props?.loot ?? o.name ?? o.prop);
    item.destroy();
  }

  open(chest) {
    chest.opened = true;
    const o = chest.pixelforgeObject, prop = o.prop;
    const anim = [`${prop}_opening`, `${prop}_open`].find((k) => this.anims.exists(k));
    if (anim) chest.play(anim);
    this.give(o.props?.loot);
  }

  // A dialog box with the object's props.text (a string, or a list of pages). The level waits while it's open.
  say(obj) {
    return pixelforgeDialog(this, { text: obj.props.text, name: obj.name, player: this.level.player });
  }

  // Touched by an enemy: lose a heart, get knocked away, blink for a second.
  hurt(enemy) {
    const p = this.level.player;
    if (this.time.now < (this.invulnerableUntil ?? 0) || state.health <= 0) return;
    this.invulnerableUntil = this.time.now + 1000;
    if (net.active) { net.combatCommand('hazard'); return; }
    if (p.combat) p.combat.receive(enemy, ATTACKS.punch);
    else { damage(ATTACKS.punch.damage); this.feel.knockback(p, enemy, 140, { lift: 160 }).shake(120, 2); }
    this.tweens.add({ targets: p, alpha: 0.3, duration: 100, yoyo: true, repeat: 4, onComplete: () => p.setAlpha(1) });
  }
}

// The fighter's Super for the HUD: their implemented special move, or the design
// doc's special, locked, until it's built.
function superMove(character) {
  const built = Object.entries(ATTACKS).find(([, spec]) => spec.character === character);
  if (built) {
    const [move, spec] = built;
    return { move, name: move[0].toUpperCase() + move.slice(1), key: spec.key, locked: false, duration: spec.cooldown };
  }
  return { move: null, name: fighter(character).special.name, key: '', locked: true, duration: 1 };
}
