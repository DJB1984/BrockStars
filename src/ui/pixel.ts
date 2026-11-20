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

// Ramps from the Brock Hall badge: pine slate, a brick / ember / amber sunset, cream and white
export const TONES = {
  ember: { o: '#12212a', h: '#f0a040', f: '#d86830', l: '#b83028', d: '#6e1f1a' },
  amber: { o: '#12212a', h: '#f8d890', f: '#f0a040', l: '#d86830', d: '#b83028' },
  brick: { o: '#12212a', h: '#d85a44', f: '#b83028', l: '#8a2420', d: '#4a1614' },
  pine: { o: '#12212a', h: '#304048', f: '#203840', l: '#182830', d: '#0c171c' },
  // the badge's banner: slate inside a white rule
  badge: { o: '#f8f8f8', h: '#304048', f: '#203840', l: '#182830' },
  deep: { o: '#12212a', h: '#304048', f: '#182830', l: '#0c171c' },
  well: { o: '#0c171c', h: '#304048', f: '#12212a', l: '#0c171c' },
  cream: { o: '#12212a', h: '#ffffff', f: '#e8d0a8', l: '#c8a878', d: '#9a7a50' },
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

// Writes every frame as a CSS custom property (--frame-panel-badge ...), so the stylesheet can use them.
export function installFrames(root: HTMLElement) {
  for (const kind of Object.keys(GRIDS) as (keyof typeof GRIDS)[]) {
    for (const tone of Object.keys(TONES) as ToneName[]) root.style.setProperty(`--frame-${kind}-${tone}`, frameUrl(kind, tone));
  }
}
