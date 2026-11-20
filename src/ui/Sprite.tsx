import { useEffect, useState, type CSSProperties } from 'react';

// Plays a pixelforge export (export/<id>.png + .json, served from the site root) at a whole-number scale,
// so the select screen shows the same frames the game does.

type Rect = { x: number; y: number; w: number; h: number };
type Sheet = {
  frames: Record<string, { frame: Rect; duration: number }>;
  meta: {
    size: { w: number; h: number };
    frameTags: { name: string; from: number; to: number }[];
    pixelforge?: { origin: [number, number]; body: Rect };   // feet, and the box the character stands in
  };
};

const sheets = new Map<string, Promise<Sheet>>();
const loadSheet = (id: string) => {
  let p = sheets.get(id);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`${id}.json: ${r.status}`);
      return r.json() as Promise<Sheet>;
    });
    sheets.set(id, p);
  }
  return p;
};

// Where the character stands in its frame: the feet (origin) and the body box.
export const spriteFrame = (id: string) => loadSheet(id).then((s) => s.meta.pixelforge);

// The first row with solid pixels in a frame of `anim` (the top of the head): where to start a headshot.
const tops = new Map<string, Promise<number>>();
export const spriteTop = (id: string, anim = 'idle_down') => {
  const key = `${id}_${anim}`;
  let p = tops.get(key);
  if (!p) {
    p = Promise.all([loadSheet(id), new Promise<HTMLImageElement>((done, fail) => {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => fail(new Error(`${id}.png`));
      img.src = `${import.meta.env.BASE_URL}${id}.png`;
    })]).then(([sheet, img]) => {
      const tag = sheet.meta.frameTags.find((t) => t.name === key);
      const { x, y, w, h } = sheet.frames[String(tag?.from ?? 0)].frame;
      const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d')!;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const alpha = ctx.getImageData(0, 0, w, h).data;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) if (alpha[(row * w + col) * 4 + 3] > 128) return row;
      }
      return 0;
    });
    tops.set(key, p);
  }
  return p;
};

export const preloadSprite = (id: string) => {
  loadSheet(id).catch(() => {});
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}${id}.png`;
};

type Props = {
  id: string;
  anim?: string;           // tag without the sprite prefix: 'idle_down', 'punch_down'
  scale: number;
  loop?: boolean;
  crop?: [number, number, number, number];   // show only this part of the frame (x, y, w, h)
  onEnd?: () => void;
  className?: string;
  style?: CSSProperties;
  label?: string;
};

export function Sprite({ id, anim = 'idle_down', scale, loop = true, crop, onEnd, className, style, label }: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let live = true;
    loadSheet(id).then((s) => live && setSheet(s)).catch(() => live && setSheet(null));
    return () => { live = false; };
  }, [id]);

  const tag = sheet?.meta.frameTags.find((t) => t.name === `${id}_${anim}`);
  const from = tag?.from ?? 0, to = tag?.to ?? 0;

  useEffect(() => {
    setIndex(0);
    if (!sheet) return;
    let i = 0, timer = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = () => {
      const frame = sheet.frames[String(from + i)];
      timer = window.setTimeout(() => {
        if (from + i >= to) {
          if (!loop) { onEnd?.(); return; }
          i = 0;
        } else i += 1;
        setIndex(i);
        step();
      }, frame?.duration ?? 150);
    };
    if (reduced && loop) return;   // hold the first frame
    if (reduced && !loop) { timer = window.setTimeout(() => onEnd?.(), 0); return () => clearTimeout(timer); }
    step();
    return () => clearTimeout(timer);
    // onEnd is read when the animation ends; restarting for a new callback would replay it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, from, to, loop]);

  const frame = sheet?.frames[String(from + index)]?.frame;
  const [cx, cy, cw, ch] = crop ?? [0, 0, frame?.w ?? 64, frame?.h ?? 64];
  const box: CSSProperties = { width: cw * scale, height: ch * scale, ...style };
  if (!sheet || !frame) return <div className={className} style={box} role="img" aria-label={label} />;
  return (
    <div
      className={className}
      role="img"
      aria-label={label}
      style={{
        ...box,
        backgroundImage: `url(${import.meta.env.BASE_URL}${id}.png)`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${sheet.meta.size.w * scale}px ${sheet.meta.size.h * scale}px`,
        backgroundPosition: `${-(frame.x + cx) * scale}px ${-(frame.y + cy) * scale}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
}
