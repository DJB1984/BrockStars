import Phaser from 'phaser';
import { loadPixelforgeAll, createPixelforgeAll, PIXELFORGE_INDEX } from '../../export/pixelforge.js';
import { showLobby } from '../lobby.js';
import { net } from '../net/session.js';

// The room every tab of the local test server (`npm run local`) shares.
const QUICK_ROOM = 'LOCAL';

// Loads everything `pixelforge export` wrote (export/index.json lists it) with a progress bar, makes every
// animation, then starts the first level: ?level=NAME in the URL, else a level called "start", else the
// first one in the index.
// Before the level, the lobby (src/lobby.js) hosts or joins a multiplayer game. It's skipped:
//   on the local test server (`npm run local`, or ?quick): straight into the level, joining room LOCAL in
//     the background, so every open tab plays together;
//   with ?level=NAME (playtests) or ?solo: straight into the level, alone.
export class Boot extends Phaser.Scene {
  constructor() { super('boot'); }

  preload() {
    const { width, height } = this.scale;
    const w = Math.round(width / 2), x = Math.round((width - w) / 2), y = Math.round(height / 2);
    this.add.rectangle(x, y, w, 6).setOrigin(0, 0.5).setStrokeStyle(1, 0x5a6988);
    const bar = this.add.rectangle(x + 1, y, 0, 4, 0xfeae34).setOrigin(0, 0.5);
    this.load.on('progress', (p) => { bar.width = Math.round((w - 2) * p); });
    loadPixelforgeAll(this, '');
  }

  async create() {
    createPixelforgeAll(this);
    const levels = this.cache.json.get(PIXELFORGE_INDEX)?.levels ?? [];
    const params = new URLSearchParams(location.search);
    const asked = params.get('level');
    const first = [asked, 'start'].find((n) => levels.includes(n)) ?? levels[0];
    if (!first) {
      this.add.text(8, 8, 'No levels yet.\nRun: pixelforge new-level start\nthen: pixelforge export',
                    { fontFamily: 'monospace', fontSize: '10px', color: '#c0cbdc' });
      return;
    }
    let character = params.get('character') ?? undefined;
    if (import.meta.env.MODE === 'quick' || params.has('quick')) {
      autoJoin(first);
    } else if (!asked && !params.has('solo')) {
      ({ character } = await showLobby({ level: first }));
    }
    this.scene.start('level', { level: first, character });
  }
}

// Joins room LOCAL, or opens it if no other tab has; when that game ends (the hosting tab closed), tries
// again, so one of the tabs left takes over as host.
function autoJoin(level) {
  const name = (() => { try { return localStorage.getItem('brockstars.name'); } catch { return null; } })()
    || `Player ${10 + (crypto.getRandomValues(new Uint8Array(1))[0] % 90)}`;
  const connect = () => net.quick({ name, level, room: QUICK_ROOM })
    .then(() => console.info(`[net] ${net.role === 'host' ? 'hosting' : 'joined'} room ${net.room} as ${name}`))
    .catch((e) => console.warn(`[net] playing solo: ${e.message}`));
  net.on('ended', () => setTimeout(connect, 500 + Math.random() * 1000));
  connect();
}
