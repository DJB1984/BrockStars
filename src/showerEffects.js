import { SHOWER, levelShowers, nearestShower, soloShowers } from './showers.js';
import { net } from './net/session.js';
import { damage, state as health } from './game.js';

export class ShowerEffects {
  constructor(scene) {
    this.scene = scene;
    this.def = levelShowers(scene.levelName);
    this.burn = 0;
    this.water = scene.add.graphics().setDepth(9000);
    this.fog = this.def.rooms.map(rects => {
      const g = scene.add.graphics().setDepth(10000).fillStyle(0xe5eff0);
      for (const r of rects) g.fillRect(r.x, r.y, r.width, r.height);
      return g.setAlpha(0);
    });
    this.bubble = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff',
      backgroundColor: '#272338', padding: { x: 5, y: 3 }, align: 'center' })
      .setOrigin(0.5, 1).setDepth(11000).setVisible(false).setInteractive({ useHandCursor: true });
    this.bubble.on('pointerdown', () => this.interact());
    this.onKey = event => { if (!event.repeat) this.interact(); };
    scene.input.keyboard.on('keydown-E', this.onKey);
    scene.events.once('shutdown', () => scene.input.keyboard.off('keydown-E', this.onKey));
  }
  state() {
    return net.active ? net.combatState.showers?.[this.scene.levelName] ?? { on: [], fog: [] } : soloShowers.state(this.scene.levelName);
  }
  interact() {
    const p = this.scene.level.player;
    if (!p?.active || this.scene.inLobby || health.health <= 0 || p.combat?.snapshot().held || p.combat?.snapshot().stunRemaining) return;
    if (net.active) net.combatCommand('interact');
    else soloShowers.toggle(this.scene.levelName, p);
  }
  update(time, delta) {
    const scene = this.scene, p = scene.level.player;
    if (!net.active) {
      soloShowers.update(delta);
      if (p?.active && health.health > 0 && soloShowers.burning(scene.levelName, p)) {
        this.burn += delta;
        while (this.burn >= SHOWER.interval) { damage(SHOWER.damage); this.burn -= SHOWER.interval; }
      } else this.burn = 0;
    } else this.burn = 0;
    const state = this.state();
    this.water.clear();
    for (const s of this.def.showers) {
      if (!state.on.includes(s.id) || !scene.rooms.canSee(s.x, s.y)) continue;
      const z = s.zone;
      this.water.fillStyle(0xffaa77, 0.16).fillRect(z.x, z.y, z.width, z.height);
      this.water.lineStyle(1, 0xaee5ff, 0.75);
      for (let i = 0; i < 7; i++) {
        const x = z.x + 3 + i*4, y = z.y + ((time*0.06+i*5) % (z.height-7));
        this.water.lineBetween(x, y, x-1, y+6);
      }
    }
    this.fog.forEach((g, r) => {
      const rect = this.def.rooms[r][0];
      g.setAlpha(scene.rooms.canSee(rect.x+8, rect.y+8) ? (state.fog[r] ?? 0)*0.78 : 0);
    });
    const s = p?.active && health.health > 0 ? nearestShower(this.def, p) : null;
    this.bubble.setVisible(!!s);
    if (s) this.bubble.setPosition(s.x, s.zone.y-19).setText(`E: ${state.on.includes(s.id) ? 'Off' : 'On'}`);
  }
}
