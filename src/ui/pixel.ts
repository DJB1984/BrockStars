// Pixel frames: tiny SVG grids used as CSS nine-slice border images, so every panel, button and field gets
// a real pixel outline with notched corners, a lit top-left edge and a shaded bottom-right edge (light comes
// from the top-left, like the sprites). One grid pixel is drawn PX screen pixels wide.

export const PX = 3;

// o outline, h highlight, f fill, l shade, d lip (the thick underside of a button), . transparent
const GRIDS = {
  // slice 3 on every side
  panel: [
    '.ooooooo.',
    'ohhhhhhho',
    'ohffffflo',
    'ohffffflo',
    'ohffffflo',
    'ohffffflo',
    'ohffffflo',
    'olllllllo',
    '.ooooooo.',
  ],
  // slice 3 3 5 3: the bottom carries a two-pixel lip
  button: [
    '.ooooooo.',
    'ohhhhhhho',
    'ohffffflo',
    'ohffffflo',
    'ohffffflo',
    'olllllllo',
    'odddddddo',
    'odddddddo',
    '.ooooooo.',
  ],
  // the same button pushed down onto its lip
  pressed: [
    '.ooooooo.',
    'ohhhhhhho',
    'ohffffflo',
    'ohffffflo',
    'ohffffflo',
    'ohffffflo',
    'olllllllo',
    '.ooooooo.',
  ],
  // a field is cut into the surface: the shade sits top-left
  field: [
    '.ooooooo.',
    'olllllllo',
    'olfffffho',
    'olfffffho',
    'olfffffho',
    'olfffffho',
    'olfffffho',
    'ohhhhhhho',
    '.ooooooo.',
  ],
} as const;

export const SLICE: Record<keyof typeof GRIDS, [number, number, number, number]> = {
  panel: [3, 3, 3, 3],
  button: [3, 3, 5, 3],
  pressed: [3, 3, 3, 3],
  field: [3, 3, 3, 3],
};

export type Tone = { o: string; h: string; f: string; l: string; d?: string };

// Endesga 32 ramps
export const TONES = {
  gold: { o: '#181425', h: '#fee761', f: '#feae34', l: '#f77622', d: '#be4a2f' },
  blue: { o: '#181425', h: '#2ce8f5', f: '#0099db', l: '#124e89', d: '#262b44' },
  red: { o: '#181425', h: '#f6757a', f: '#e43b44', l: '#a22633', d: '#3e2731' },
  slate: { o: '#181425', h: '#8b9bb4', f: '#5a6988', l: '#3a4466', d: '#262b44' },
  night: { o: '#181425', h: '#5a6988', f: '#262b44', l: '#1d1a30', d: '#0e0b16' },
  chalk: { o: '#181425', h: '#ffffff', f: '#ffffff', l: '#c0cbdc' },
  ink: { o: '#181425', h: '#5a6988', f: '#181425', l: '#0e0b16' },
  paper: { o: '#181425', h: '#ffffff', f: '#ead4aa', l: '#e4a672' },
} satisfies Record<string, Tone>;

export type ToneName = keyof typeof TONES;

const svg = (rows: readonly string[], tone: Tone) => {
  const w = rows[0].length, h = rows.length;
  let rects = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    const fill = (tone as Record<string, string | undefined>)[c];
    if (c !== '.' && fill) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
};

const cache = new Map<string, string>();
export function frameUrl(kind: keyof typeof GRIDS, tone: ToneName): string {
  const key = `${kind}:${tone}`;
  let url = cache.get(key);
  if (!url) {
    url = `url("data:image/svg+xml,${encodeURIComponent(svg(GRIDS[kind], TONES[tone]))}")`;
    cache.set(key, url);
  }
  return url;
}

// Writes every frame as a CSS custom property (--frame-panel-gold ...), so the stylesheet can use them.
export function installFrames(root: HTMLElement) {
  for (const kind of Object.keys(GRIDS) as (keyof typeof GRIDS)[]) {
    for (const tone of Object.keys(TONES) as ToneName[]) root.style.setProperty(`--frame-${kind}-${tone}`, frameUrl(kind, tone));
  }
}
