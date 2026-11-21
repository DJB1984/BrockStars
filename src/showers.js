// Shared shower rules for solo play and the multiplayer host.
export const SHOWER = Object.freeze({ damage: 5, interval: 1000, fogIn: 20000, fogOut: 15000, reach: 38 });
const levels = new Map();
export const levelShowers = name => levels.get(name) ?? { showers: [], rooms: [] };
export function registerLevelShowers(name, data) {
  if (!data) return;
  const gids = new Set();
  for (const set of data.tilesets ?? []) for (const tile of set.tiles ?? [])
    if (tile.properties?.some(p => p.name === 'name' && p.value === 'bathroom_floor')) gids.add(set.firstgid + tile.id);
  const cells = new Int32Array(data.width * data.height).fill(-1), floor = new Set();
  for (const layer of data.layers ?? []) if (layer.type === 'tilelayer')
    layer.data?.forEach((gid, i) => { if (gids.has(gid & 0x1fffffff)) floor.add(i); });
  const rooms = [], tw = data.tilewidth, th = data.tileheight;
  for (const start of floor) {
    if (cells[start] >= 0) continue;
    const id = rooms.length, stack = [start], rects = [];
    cells[start] = id;
    while (stack.length) {
      const i = stack.pop(), x = i % data.width, y = Math.floor(i / data.width);
      rects.push({ x: x * tw, y: y * th, width: tw, height: th });
      for (const j of [x > 0 ? i-1 : -1, x < data.width-1 ? i+1 : -1, i-data.width, i+data.width])
        if (floor.has(j) && cells[j] < 0) { cells[j] = id; stack.push(j); }
    }
    rooms.push(rects);
  }
  const showers = (data.pixelforge?.objects ?? []).filter(o => o.prop === 'shower_stall_central').map(o => {
    // Art is 44x50, origin (22,18), with a solid left divider.
    const zone = { x: o.x-16, y: o.y, width: 34, height: 32 };
    const x = zone.x+zone.width/2, y = zone.y+zone.height/2;
    return { id: o.id, x, y, zone, room: cells[Math.floor(y/th)*data.width+Math.floor(x/tw)] };
  });
  levels.set(name, { showers, rooms });
}
export function nearestShower(def, position) {
  let nearest = null, distance = SHOWER.reach;
  for (const s of def.showers) {
    const room = def.rooms[s.room];
    if (!room?.some(r => position.x >= r.x && position.x < r.x+r.width && position.y-1 >= r.y && position.y-1 < r.y+r.height)) continue;
    const d = Math.hypot(s.x-position.x, s.y-position.y);
    if (d < distance) { nearest = s; distance = d; }
  }
  return nearest;
}
export function underShower(s, p) {
  // Positions are feet: sample just above them, including contact with the back wall.
  const z = s.zone;
  return p.x >= z.x && p.x < z.x+z.width && p.y-1 >= z.y && p.y-1 < z.y+z.height;
}
export class ShowerWorld {
  constructor(definitions = levelShowers) { this.definitions = definitions; this.levels = Object.create(null); }
  state(name) { return this.levels[name] ??= { on: [], fog: this.definitions(name).rooms.map(() => 0) }; }
  toggle(name, position) {
    const s = nearestShower(this.definitions(name), position);
    if (!s) return false;
    const state = this.state(name), i = state.on.indexOf(s.id);
    if (i < 0) state.on.push(s.id); else state.on.splice(i, 1);
    return true;
  }
  update(delta) {
    for (const [name, state] of Object.entries(this.levels)) {
      const def = this.definitions(name);
      state.fog = def.rooms.map((_, room) => {
        const running = def.showers.some(s => s.room === room && state.on.includes(s.id));
        return Math.max(0, Math.min(1, (state.fog[room] ?? 0) + delta * (running ? 1/SHOWER.fogIn : -1/SHOWER.fogOut)));
      });
    }
  }
  burning(name, position) {
    const state = this.state(name);
    return this.definitions(name).showers.some(s => state.on.includes(s.id) && underShower(s, position));
  }
}
export const soloShowers = new ShowerWorld();
