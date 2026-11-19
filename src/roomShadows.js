// Rooms you can't see into from the hall, but can see out of. Every room you aren't standing in is under a
// dark shadow, and anyone inside it is hidden: from the hall you see dark rooms, from a room you see the
// halls (and your own room), but not the other rooms.
//
//   this.rooms = new RoomShadows(this, level, [player.x, player.y]);   // (x, y): where the viewer starts
//   every frame: this.rooms.update(player.x, player.y);    then: sprite.setVisible(this.rooms.canSee(x, y));
//
// What's a room comes from the map: hallway floor is a tile with the "hall" property (the dorm's `hall`,
// which looks like `rug`). Any other floor is a room. Each room is the floor you can walk around without
// crossing a wall (a tile with "wall") or a hall tile, so a doorway belongs to its room, and so do stairs
// (solid, but not walls). A wall goes with the floor below it (in 3/4 view a room's back wall is inside the
// room), so a hall's own back wall stays lit. The tops of walls always stay lit: a wall tile's "top" is how
// many pixels of it, from its top edge, are the wall's top (16 for a cap, 3 for the lip over a wall face).
// A room's furniture y-sorts among the characters, so while the room is dark it drops under the shadow,
// and goes back to sorting by its feet when you walk in. It's in the room its footprint stands in.

const COLOR = 0x181425, ALPHA = 0.88, FADE_MS = 160;
const SHADOW_DEPTH = -4000;        // over the tile layers (-5000 + i), under everything that y-sorts
const UNDER_SHADOW = -4500;        // a dark room's furniture, still sorted by its feet among itself

export class RoomShadows {
  constructor(scene, level, [x, y] = [-1, -1]) {
    this.scene = scene;
    const { map } = level, layers = Object.values(level.layers).filter((l) => l.depth < SHADOW_DEPTH);
    this.map = map;
    const W = map.width, H = map.height;
    const tiles = (x, y) => layers.map((l) => l.getTileAt(x, y)).filter(Boolean);
    const WALL = -1, HALL = -2, EMPTY = -3, FLOOR = -4;
    const kind = new Int32Array(W * H), top = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tiles(x, y), wall = t.find((tile) => tile.properties?.wall);
      kind[y * W + x] = !t.length ? EMPTY : wall ? WALL : t.some((tile) => tile.properties?.hall) ? HALL : FLOOR;
      top[y * W + x] = wall?.properties.top ?? 0;
    }
    // each room: the floor reachable without crossing a wall or the hall
    const room = new Int32Array(W * H).fill(-1);
    let rooms = 0;
    for (let i = 0; i < W * H; i++) {
      if (kind[i] !== FLOOR || room[i] >= 0) continue;
      const stack = [i];
      room[i] = rooms;
      while (stack.length) {
        const j = stack.pop(), x = j % W;
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) {
          if (k >= 0 && k < W * H && kind[k] === FLOOR && room[k] < 0) { room[k] = rooms; stack.push(k); }
        }
      }
      rooms++;
    }
    // walls: whatever the floor under them is (a room's back wall is in the room)
    for (let x = 0; x < W; x++) {
      for (let y = H - 2; y >= 0; y--) if (kind[y * W + x] === WALL) room[y * W + x] = room[(y + 1) * W + x];
    }
    this.room = room;

    this.shadows = [];
    for (let r = 0; r < rooms; r++) this.shadows.push(scene.add.graphics().setDepth(SHADOW_DEPTH).fillStyle(COLOR));
    const tw = map.tileWidth, th = map.tileHeight;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {   // one rectangle per run of a room's cells along a row, under any wall top
        const i = y * W + x, r = room[i], lit = Math.min(th, top[i]);
        let end = x + 1;
        while (end < W && room[y * W + end] === r && top[y * W + end] === top[i]) end++;
        if (r >= 0 && lit < th) this.shadows[r].fillRect(x * tw, y * th + lit, (end - x) * tw, th - lit);
        x = end;
      }
    }
    this.furniture = this.shadows.map(() => []);
    for (const p of level.props) {
      // the middle of its footprint: a urinal's feet are on the wall it hangs on, its footprint in the room
      const at = p.body ? p.body.center : { x: p.x, y: p.y - 1 };
      const r = p.pixelforge?.ysort ? this.roomAt(at.x, at.y) ?? this.roomAt(p.x, p.y - 1) : null;
      if (r !== null) this.furniture[r].push(p);
    }
    this.viewer = undefined;
    this.update(x, y);
  }

  // The room at world (x, y), or null for the hall (and outside the building).
  roomAt(x, y) {
    const tx = Math.floor(x / this.map.tileWidth), ty = Math.floor(y / this.map.tileHeight);
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return null;
    const r = this.room[ty * this.map.width + tx];
    return r >= 0 ? r : null;
  }

  // Can the viewer see something standing (feet) at (x, y)? Anything in the hall or in the viewer's room.
  canSee(x, y) {
    const r = this.roomAt(x, y - 1);
    return r === null || r === this.viewer;
  }

  // The viewer's feet are at (x, y): light their room, darken the one they left.
  update(x, y) {
    const viewer = this.roomAt(x, y - 1);
    if (viewer === this.viewer) return;
    const first = this.viewer === undefined;
    this.viewer = viewer;
    this.shadows.forEach((shadow, r) => {
      const dark = r !== viewer, furniture = this.furniture[r];
      const target = dark ? ALPHA : 0;
      if (shadow.alpha === target && !first) return;
      this.scene.tweens.killTweensOf(shadow);
      // going dark: under the shadow at once, then it fades in over them. Lighting up: they stay under it
      // while it fades out, so they brighten with the floor, then sort among the characters again.
      if (dark) for (const p of furniture) p.setDepth(UNDER_SHADOW + p.y / 1000);
      const lit = () => { if (!dark) for (const p of furniture) p.setDepth(p.y); };
      if (first) { shadow.setAlpha(target); lit(); }
      else this.scene.tweens.add({ targets: shadow, alpha: target, duration: FADE_MS, onComplete: lit });
    });
  }
}
