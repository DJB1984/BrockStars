import { ShowerEffects } from '../showerEffects.js';
import Phaser from 'phaser';
import { pixelforgeLevel, enablePixelforgeHits, drawPixelforgeBoxes, installPixelforgePlay, pixelforgeFeel, pixelforgeDialog,
         spawnPixelforgeFx } from '../../export/pixelforge.js';
import { state, bus, damage, addCoins, addItem, reset, playerHealth } from '../game.js';
import { TitusCombat } from '../combat/TitusCombat.js';
import { HitFeel } from '../combat/hitFeel.js';
import { FightMarks } from '../combat/fightMarks.js';
import { ATTACKS, BLOCK, DODGE, OPPOSITE, characterAttack, directionTo } from '../combat/rules.js';
import { KO, koAlpha, safeAlpha } from '../combat/match.js';
import { dudClick } from '../sound.js';
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

// Kill feed line ids, and the names of players seen this session: both outlive a scene's restart (a door).
let feedLines = 0;
const NAMES = new Map();

// One scene plays every level: pixelforgeLevel builds it from export/levels/<name>.json (map, props,
// sprites, the player at the spawn, the camera), and this scene adds the rules:
//   doors ("type": "door", "to": a level, "spawn": where to arrive) restart it in the next level;
//   items ("type": "item" or "coin") are picked up on touch: props.loot "coin" (or a coin) adds coins,
//     any other loot (or the item's name) goes into the inventory;
//   chests ("type": "chest") open on touch and give their props.loot;
//   anything with props.text (a sign, an NPC, a trigger zone) opens a dialog box on touch, once per visit;
//   TYPES: sprites with those types get a behaviour object (enemies hurt on touch, die to attacks).
// Hits land with this.hitFeel (combat/hitFeel.js), whoever threw them (this player, an enemy, or a fight between
// two other players the host resolved): the two fighters freeze, the victim shakes, flashes and flinches, a
// spark pops at the contact point, and the camera shakes only for someone in the fight. A miss swishes.
// Every swing whooshes from its wind-up and every hit is heard (sound.js): loud for your own fight, fading
// with distance for others', silent from a room you can't see into. The menu's Volume and Mute apply.
// Online, your own swing that visibly reaches someone is felt at once (predictHit); the host's answer, judged
// against what your screen showed (lag compensation, net/combat.js), only brings the damage.
// this.marks (combat/fightMarks.js) keeps the fight readable: rings at everyone's feet, a second one while a
// Super is ready, a glint as heavy moves wind up, "MASH!" over anyone held or stunned. A hit from someone
// you can't see points an arrow at them from the edge of the screen.
// Multiplayer (src/net/): the other players in this level are drawn from `net`, and this player's state is
// sent to them every frame.
// The HUD is React (src/ui/Hud.tsx) over the canvas: this scene tells it, through src/ui/bridge.ts, who's
// online and when each move comes back, and gives its menu Change fighter and Leave game. A move pressed
// while it's still cooling down wiggles its keycap and clicks (combat-dud).
// Health is a bar over every fighter's head (objects/HeadBar.js), drawn here in the world.
// A KO (combat/match.js) lands harder (hitFeel.js), and the fighter goes down in the knockdown pose and fades
// out while the screen dims and says who did it; KO.respawn later they're back at the level's spawn, in this
// same scene (camera, HUD and rooms as they were), blinking and untouchable for KO.safe or until they swing.
// Online the host credits each KO: a kill feed under the online count, and the session's scores in the menu
// and on a held Tab (the HUD), with a crown and KO streaks on the name tags (net/remotes.js).
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
    this.koed = null;        // { at }: down after a KO, until respawn()
    this.safeUntil = 0;      // back from a KO: blinking, untouchable
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
    this.hitFeel = new HitFeel(this, { me: () => this.level.player, crowd: () => this.fightersOnScreen() });
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
      // After this hit's own pose and freeze are set (the call that emptied the health is still running).
      if (!net.active) this.time.delayedCall(0, () => this.knockedOut(null, null));
    });

    this.remotes = new RemotePlayers(this, net);
    this.marks = new FightMarks(this, () => this.markedFighters());
    this.predicted = new Map();   // remote id -> { move, at }: hits felt before the host confirmed them
    this.hitArrows = 0;
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
        this.combat = new TitusCombat(this, player, { health: playerHealth, targets: hittable,
          onHit: (target, move, result) => this.hitFeel.land(player, target, move, result),
          onWhiff: (sprite, move, facing) => this.hitFeel.whiff(sprite, move, facing),
          others: () => this.remotes.sprites(),
          onPredict: (other, move) => this.predictHit(other, move) });
        this.marks.follow(this.combat);
        on(player, 'pixelforge-attack', () => {
          this.safeUntil = 0;   // swinging gives up the spawn safety (the host does the same)
          const attack = this.combat.rules.attack;
          if (attack) this.hitFeel.swing(player, attack.name);
          if (attack) net.combatCommand(attack.name, attack.facing, this.remotes.seenTime());
        });
        on(player, 'combat-dud', (move) => {
          hud.set({ dud: { move, id: (hud.get().dud?.id ?? 0) + 1 } });
          dudClick(this);
        });
        on(player, 'combat-block', (facing) => net.combatCommand('block', facing));
        on(player, 'combat-release', () => net.combatCommand('release'));
        on(player, 'combat-dodge', (facing) => net.combatCommand('dodge', facing));
        on(player, 'combat-mash', () => net.combatCommand('mash'));
        let life = net.combatState.fighters[net.id]?.life ?? 0;
        on(net, 'combat', ({fighters, hits}) => {
          const self = fighters[net.id];
          if (!self || !player.active || this.inLobby) return;
          const r = this.combat.rules, now = this.time.now;
          this.combat.rules.readyAt.bellow = this.time.now + (self.bellowCooldown ?? 0);
          this.combat.networkStunPosition = self.stunPosition;
          // Mashed out of a stun early (the host shortened it): the flinch that held it ends with it.
          if (r.stunUntil > now + (self.stun ?? 0) + 100) {
            r.staggerUntil = Math.min(r.staggerUntil, now + (self.stun ?? 0));
            this.combat.controller.stunnedUntil = Math.min(this.combat.controller.stunnedUntil ?? 0, now + (self.stun ?? 0));
          }
          // The one you held mashed out: skip the rest of the choke, straight to the recovery.
          if (this.combat.networkGrapple && !self.grapple && r.attack?.name === 'grapple') {
            const frames = ATTACKS.grapple.frames, total = frames.reduce((a, b) => a + b, 0), recovery = (total - frames[3]) / total;
            if (player.anims.getProgress() < recovery - 0.05) player.anims.setProgress(recovery);
          }
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
          // Back from a KO (or a new host that never saw it: up, with health, and no KO).
          if (self.life !== life || (this.koed && !self.ko && self.health > 0)) {
            life = self.life;
            this.respawn();
          }
          if (!this.koed) this.safeUntil = Math.min(this.safeUntil, now + (self.safe ?? 0));   // only ever shortened (by your swing)
          if (playerHealth.value !== self.health) {
            playerHealth.value = self.health;
            playerHealth.onChange(self.health);
          }
          for (const hit of hits) if (hit.target === net.id) {
            this.combat.applyHit(hit.from ?? {x:player.x-1,y:player.y}, hit);
          }
          if (self.ko && !self.health && !this.koed) this.knockedOut(self.ko.by ? this.nameOf(self.ko.by) : null, self.ko.facing);
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
    // Every hit the host resolved in this level, felt here. This player's own hits were applied just above,
    // so their hurt pose is already playing when the freeze holds it.
    on(net, 'combat', ({ hits, kos, fighters, leader }) => {
      if (this.inLobby) return;
      for (const k of kos ?? []) this.feedKo(k);
      this.pushScores(fighters, leader);
      for (const hit of hits) {
        const victim = hit.target === net.id ? player : this.remotes.sprite(hit.target);
        const attacker = hit.source === net.id ? player : this.remotes.sprite(hit.source);
        if (hit.target === net.id && hit.source && hit.source !== net.id) this.pointAtHitter(attacker, hit.from);
        // Already felt the moment your swing reached them: the host's answer only brings the damage.
        // A perfect block always shows: it couldn't be predicted.
        const felt = hit.source === net.id && !hit.perfect && this.predicted.get(hit.target);
        if (felt && felt.move === hit.move && felt.ko === !!hit.ko && this.time.now - felt.at < 700) { this.predicted.delete(hit.target); continue; }
        // The host answered before this screen saw the swing connect (a fast connection): don't feel it again then.
        const swing = this.combat?.swing;
        if (hit.source === net.id && victim && swing && this.combat.rules.attack?.name === hit.move) swing.predicted.add(victim);
        // Your own swing confirmed after it already ended: spark and shake, but don't stop you mid-step.
        this.hitFeel.land(attacker, victim, hit.move, hit, { freezeAttacker: attacker !== player || !!this.combat?.rules.attack });
      }
    });

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
                     y: Math.round(p.y * 10) / 10, anim: p.anims.currentAnim?.key ?? null, flip: p.flipX,
                     ...(this.combat?.rules.dodge ? { dodge: this.combat.rules.dodge.start } : {}) });
    }
    if (this.combat) this.combat.online = net.active;   // the host shortens holds and stuns you mash out of
    if (p?.active) this.rooms.update(p.x, p.y);
    if (p?.active && this.koed) {
      const alpha = koAlpha(time - this.koed.at);
      p.setAlpha(alpha);
      this.selfBar?.setVisible(alpha > 0);
    } else if (p?.active && time < this.safeUntil) { p.setAlpha(safeAlpha(time)); this.blinking = true; }
    else if (p?.active && this.blinking) { p.setAlpha(1); this.blinking = false; }
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

  // Your swing visibly reached another player (as this screen draws them): feel the hit now, as the host will
  // almost certainly agree (it judges against the same moment). If it doesn't, only the damage is missing.
  predictHit(other, move) {
    const player = this.level.player, state = net.combatState.fighters[other.netId], spec = ATTACKS[move];
    if (!player?.active || !state?.health || state.held || state.safe) return;
    // Their block covers every side but behind them.
    const blocked = !spec.unblockable && !!state.block && directionTo(player.x - other.x, player.y - other.y) !== OPPOSITE[state.block];
    // The last of their health: the KO is felt now too.
    const ko = characterAttack(this.character, move).damage * (blocked ? 1 - BLOCK.reduction : 1) >= state.health;
    this.hitFeel.land(player, other, move, { damage: 1, blocked, knockdown: blocked ? 0 : spec.knockdown ?? 0, ...(ko ? { ko } : {}) });
    this.predicted.set(other.netId, { move, at: this.time.now, ko });
  }

  // KO'd: down in the knockdown pose (toward `facing`), fading out, the screen dimmed with who did it (`by`, a
  // name, or null). Online the host says when you're back; alone, it's KO.respawn from now.
  knockedOut(by, facing) {
    const p = this.level.player;
    if (this.koed || !p?.active) return;
    this.koed = { at: this.time.now };
    this.safeUntil = 0;
    this.combat?.knockOut(facing);
    hud.set({ ko: { by, endsAt: performance.now() + KO.respawn } });
    if (!net.active) this.time.delayedCall(KO.respawn, () => this.respawn());
  }

  // Back on your feet at the level's spawn, with full health, in this same scene: the camera, the HUD and the
  // rooms carry on. You blink, untouchable, for KO.safe.
  respawn() {
    const p = this.level.player;
    this.koed = null;
    hud.set({ ko: null });
    if (!p?.active) return;
    reset();
    const spawns = this.level.spawns, at = spawns[this.spawnName] ?? spawns.player ?? Object.values(spawns)[0];
    if (at) p.body.reset(at.x, at.y);
    p.setAlpha(1);
    this.selfBar?.setVisible(true);
    this.combat?.revive();
    this.predicted.clear();
    this.safeUntil = this.invulnerableUntil = this.time.now + KO.safe;
    this.cameras.main.fadeIn(220, 18, 33, 42);
  }

  // Someone's name: yours, or the other player's as their updates carry it (remembered after they leave).
  nameOf(id) {
    const name = id === net.id ? net.name : net.players[id]?.name;
    if (name) NAMES.set(id, name);
    return name || NAMES.get(id) || 'Player';
  }

  // A KO the host credited: a kill feed line, and another when it ended a streak (KO.streak or more).
  feedKo(k) {
    const at = performance.now(), mine = k.victim === net.id || k.by === net.id;
    const victim = k.victimName || this.nameOf(k.victim), by = k.by ? k.byName || this.nameOf(k.by) : null;
    const lines = [{ id: ++feedLines, at, kind: 'ko', by, victim, mine }];
    if (k.ended && by) lines.push({ id: ++feedLines, at, kind: 'streak', by, victim, mine });
    hud.set({ feed: [...hud.get().feed.filter((l) => at - l.at < KO.feed), ...lines].slice(-5) });
  }

  // The session's scores for the HUD's board, best first; sent only when they change.
  pushScores(fighters = {}, leader = null) {
    const rows = Object.entries(fighters).filter(([, f]) => f.score).map(([id, f]) => ({ id, name: this.nameOf(id),
      kos: f.score.kos, falls: f.score.falls, streak: f.score.streak, me: id === net.id, leader: id === leader }))
      .sort((a, b) => b.kos - a.kos || a.falls - b.falls || a.name.localeCompare(b.name));
    const key = JSON.stringify(rows);
    if (key !== this.scoresKey) { this.scoresKey = key; hud.set({ scores: rows }); }
  }

  // Hit by someone you can't see (off the screen, or in a dark room): an arrow at the screen's edge points
  // toward them. `from` is where the host saw them, if their sprite isn't here.
  pointAtHitter(attacker, from) {
    const p = this.level.player, view = this.cameras.main.worldView, at = attacker ?? from;
    if (!p?.active || !at || (attacker?.visible && view.contains(attacker.x, attacker.y))) return;
    hud.set({ hitArrow: { id: ++this.hitArrows, angle: Math.atan2(at.y - p.y, at.x - p.x),
      from: [(p.x - view.x) / view.width, (p.y - view.y) / view.height] } });
  }

  // Who fightMarks.js draws rings, Super rings and "MASH!" around: you, the other players, the enemies.
  markedFighters() {
    const p = this.level.player, out = [];
    if (p?.active && this.combat) {
      const r = this.combat.rules, special = this.superMove.move, alive = r.health.value > 0;
      out.push({ sprite: p, mine: true, alive,
        superReady: alive && !!special && this.time.now >= (r.readyAt[special] ?? 0),
        mash: !!r.heldBy || this.time.now < r.stunUntil });
    }
    for (const s of this.remotes.sprites()) out.push({ sprite: s, mine: false, alive: s.alive, superReady: s.superReady, mash: s.mash });
    for (const a of this.actors) if (a.hp !== undefined && a.sprite.active) out.push({ sprite: a.sprite, mine: false, alive: a.hp > 0 });
    return out;
  }

  // Fighters on the camera: you, the other players and the enemies. A crowd shortens each hit's freeze.
  fightersOnScreen() {
    const view = this.cameras.main.worldView;
    return (this.level.player?.active ? 1 : 0) + this.remotes.onScreen()
      + this.actors.filter((a) => a.sprite.active && view.contains(a.sprite.x, a.sprite.y)).length;
  }

  // A short message at the top of the screen (the game ended, the host left).
  toast(text) {
    hud.toast(text);
  }

  // Every move's keycap (punch, kick, headbutt, Block, the Super): sent when a cooldown starts or a block goes
  // up or down, as deadlines the HUD counts down by itself.
  pushHud() {
    const snap = this.combat?.snapshot();
    if (!snap) return;
    const now = performance.now();
    const shield = snap.blocking ? { phase: 'holding', endsAt: now + snap.blockRemaining, duration: BLOCK.duration }
      : snap.blockCooldown ? { phase: 'cooldown', endsAt: now + snap.blockCooldown, duration: BLOCK.cooldown }
      : { phase: 'ready' };
    const left = this.superMove.move ? snap.cooldowns[this.superMove.move] : 0;
    const special = { ...this.superMove, endsAt: left ? now + left : 0 };
    const moves = Object.fromEntries(['punch', 'kick', 'headbutt'].map((name) => [name,
      { endsAt: snap.cooldowns[name] ? now + snap.cooldowns[name] : 0, duration: characterAttack(this.character, name).cooldown }]));
    const dodge = { endsAt: snap.cooldowns.dodge ? now + snap.cooldowns.dodge : 0, duration: DODGE.cooldown };
    const shown = hud.get();
    const moved = (a, b) => a.phase !== b.phase || Math.abs((a.endsAt ?? 0) - (b.endsAt ?? 0)) > 120;
    const cooling = (t) => ({ phase: 'cooldown', ...t });
    if (moved(shown.shield, shield) || moved(cooling(shown.super), cooling(special)) || moved(cooling(shown.dodge), cooling(dodge))
        || Object.keys(moves).some((name) => moved(cooling(shown.moves[name]), cooling(moves[name])))) {
      hud.set({ shield, super: special, moves, dodge });
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
    if (p.combat) {
      const result = p.combat.receive(enemy, ATTACKS.punch);
      this.hitFeel.land(enemy, p, 'punch', result);
      if (!result.damage) return;   // perfectly blocked or dodged: no blink
    } else { damage(ATTACKS.punch.damage); this.feel.knockback(p, enemy, 140, { lift: 160 }).shake(120, 2); }
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
