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
} as const;

export type IconName = keyof typeof ICONS;

type Props = { name: IconName; size: number; flip?: boolean; className?: string };

// `size` is the screen size of one grid pixel
export function Icon({ name, size, flip, className }: Props) {
  const rows = ICONS[name];
  const w = rows[0].length, h = rows.length;
  return (
    <svg
      className={className}
      width={w * size}
      height={h * size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === 'x'
        ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
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
