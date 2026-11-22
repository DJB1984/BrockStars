import type { JSX } from 'react';

// Pixel icons drawn on the same grid as the frames: x is the ink (currentColor).

const ICONS = {
  right: [
    'x....',
    'xx...',
    'xxx..',
    'xxxx.',
    'xxxxx',
    'xxxx.',
    'xxx..',
    'xx...',
    'x....',
  ],
  back: [
    '...x.',
    '..xx.',
    '.xxx.',
    'xxxx.',
    '.xxx.',
    '..xx.',
    '...x.',
  ],
  star: [
    '...x...',
    '...x...',
    '..xxx..',
    'xxxxxxx',
    '..xxx..',
    '...x...',
    '...x...',
  ],
  person: [
    '.xxx.',
    '.xxx.',
    '..x..',
    'xxxxx',
    '.xxx.',
    '.x.x.',
  ],
  // the moves, for the HUD and the touch buttons (o is a half-tone shade of the ink)
  // a fist seen from the front: four knuckles, the thumb folded across, the wrist
  punch: [
    '.xx.xx.xx.x.',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'x..x..x..xxx',
    'xxxxxxxxxxxx',
    'xxx......xxx',
    '.xxxxxxxxxx.',
    '..xxxxxxxx..',
    '...xxxxxx...',
    '...xxxxxx...',
  ],
  kick: [
    '.xxxo....',
    '.xxxo....',
    '.xxxo....',
    '.xxxo....',
    '.xxxxx...',
    '.xxxxxxx.',
    '.xxxxxxxx',
    'oooooooo.',
  ],
  // a head in profile, facing forward: half-tone hair, one eye under the brow, nose and chin
  // (no stray sparks: the keys' 3px outline fills any gap smaller than ~3 cells)
  headbutt: [
    '...oooooo...',
    '.ooooooooo..',
    'oooooooooxx.',
    'oooooooxxxxx',
    'ooooxxxx.xx.',
    'oooxxxxxxxx.',
    'ooxxxxxxxxxx',
    '.oxxxxxxxxx.',
    '..xxxxxxxx..',
    '..xxxxxxxxx.',
    '...xxxxxxx..',
    '....xxxxx...',
    '....xxx.....',
    '....xxx.....',
  ],
  block: [
    'xxxxxxxxx',
    'xxxxoxxxx',
    'xxxxoxxxx',
    'xoooooooo',
    'xxxxoxxxo',
    '.xxxoxxo.',
    '..xxoxo..',
    '...xoo...',
    '....o....',
  ],
  // the Super: a lightning bolt
  takedown: [
    '.....xxx',
    '....xxx.',
    '...xxx..',
    '..xxx...',
    '.xxxxxxx',
    'xxxxxxx.',
    '...xxx..',
    '..xxx...',
    '.xxx....',
    '.xx.....',
    'x.......',
  ],
  bellow: [
    '...x....x...',
    '..x......x..',
    '.x..x..x..x.',
    'x..x....x..x',
    'x..x.xx.x..x',
    'x..x.xx.x..x',
    'x..x....x..x',
    '.x..x..x..x.',
    '..x......x..',
    '...x....x...',
  ],
  grapple: [
    '..xxxxx..',
    '.x.....x.',
    'x.......x',
    'x.......x',
    '.x.....x.',
    '..xxxxx..',
    '....x....',
    '.....x...',
    '......xx.',
  ],
  // the dodge: a double chevron, fast forward
  dodge: [
    'xx...xx....',
    '.xx...xx...',
    '..xx...xx..',
    '...xx...xx.',
    '....xx...xx',
    '...xx...xx.',
    '..xx...xx..',
    '.xx...xx...',
    'xx...xx....',
  ],
  lock: [
    '..xxxxx..',
    '.xx...xx.',
    '.x.....x.',
    '.x.....x.',
    'xxxxxxxxx',
    'xxxxxxxxx',
    'xxxxoxxxx',
    'xxxxoxxxx',
    'xxxxxxxxx',
  ],
  menu: [
    'xxxxxxx',
    'xxxxxxx',
    '.......',
    'xxxxxxx',
    'xxxxxxx',
    '.......',
    'xxxxxxx',
    'xxxxxxx',
  ],
  close: [
    'xx...xx',
    'xxx.xxx',
    '.xxxxx.',
    '..xxx..',
    '.xxxxx.',
    'xxx.xxx',
    'xx...xx',
  ],
} as const;

export type IconName = keyof typeof ICONS;

type Props = { name: IconName; size: number; flip?: boolean; rotate?: number; className?: string };

// `size` is the screen size of one grid pixel
export function Icon({ name, size, flip, rotate, className }: Props) {
  const rows: readonly string[] = ICONS[name];
  const w = rows[0].length, h = rows.length;
  const transform = [flip && 'scaleX(-1)', rotate && `rotate(${rotate}deg)`].filter(Boolean).join(' ');
  return (
    <svg
      className={className}
      width={w * size}
      height={h * size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={transform ? { transform } : undefined}
    >
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === 'x' || c === 'o'
        ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" opacity={c === 'o' ? 0.5 : undefined} />
        : null)))}
    </svg>
  );
}

// A rasterised ellipse: the floor a fighter stands on. Cells inside the ellipse are filled; the top rim is lit.
export function Platform({ w, h, size, top, fill, rim }: { w: number; h: number; size: number; top: string; fill: string; rim: string }) {
  const cells: JSX.Element[] = [];
  const a = w / 2, b = h / 2;
  const inside = (x: number, y: number) => ((x + 0.5 - a) / a) ** 2 + ((y + 0.5 - b) / b) ** 2 <= 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x, y - 1) || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y + 1);
      const color = edge ? (y < b ? top : rim) : fill;
      cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />);
    }
  }
  return (
    <svg width={w * size} height={h * size} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
      {cells}
    </svg>
  );
}
