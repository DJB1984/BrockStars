// Walls block hits: a punch, a kick or a lunge can't land on someone on the other side of a wall, however
// close they are. A level's walls are its tiles with the "wall" property (the dorm's `wall*`), read from its
// exported Tiled map, so the host can resolve hits in any level, not only the one it's standing in.
//
//   registerLevelWalls('brock3', scene.cache.tilemap.get('brock3').data);   // once, at boot
//   wallBetween(levelWalls('brock3'), a, b)                                 // is there a wall between?
//
// Positions are feet (the sprite's origin). The feet box can't overlap a wall, so the pixel just above the
// feet is always floor, and the line between two fighters' feet crosses a wall exactly when one is between them.

const LEVEL_WALLS = new Map();

// A Tiled map (with its tilesets embedded, as `pixelforge export` writes them) → which cells are walls.
export function wallGridFromTiled(data) {
  const wallGids = new Set();
  for (const set of data.tilesets ?? []) {
    for (const tile of set.tiles ?? []) {
      if (tile.properties?.some((p) => p.name === 'wall' && p.value)) wallGids.add(set.firstgid + tile.id);
    }
  }
  const width = data.width, height = data.height, cells = new Uint8Array(width * height);
  for (const layer of data.layers ?? []) {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data)) continue;
    layer.data.forEach((gid, i) => { if (wallGids.has(gid & 0x1fffffff)) cells[i] = 1; });
  }
  return { tileWidth: data.tilewidth, tileHeight: data.tileheight, width, height, cells };
}

export function registerLevelWalls(name, data) {
  if (data) LEVEL_WALLS.set(name, wallGridFromTiled(data));
}

export const levelWalls = (name) => LEVEL_WALLS.get(name) ?? null;

function isWall(grid, x, y) {
  const tx = Math.floor(x / grid.tileWidth), ty = Math.floor(y / grid.tileHeight);
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
  return grid.cells[ty * grid.width + tx] === 1;
}

// Does the line from a's feet to b's feet cross a wall? Sampled every pixel: hits reach ~60px, so it's cheap,
// and a 16px wall tile can't slip between samples.
export function wallBetween(grid, a, b) {
  if (!grid) return false;
  const ax = a.x, ay = a.y - 1, dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    if (isWall(grid, ax + dx * t, ay + dy * t)) return true;
  }
  return false;
}
