// The match's two badges as pixel art, one character a pixel: the session leader's crown and the KO streak's
// flame. Name tags (objects/HeadBar.js) draw them as SVG strings, the HUD's scoreboard (Hud.tsx) as React.
// k ink, y gold, w its glint, o flame orange, r its red heart.
export const CROWN = ['k.k.k.k', 'kykwkyk', 'kyyyyyk', 'kyyyyyk', 'kkkkkkk'];
export const FLAME = ['..k..', '.kok.', 'kooyk', 'korok', '.kkk.'];
export const BADGE_COLORS = { k: '#12212a', y: '#feae34', w: '#ffffff', o: '#f77622', r: '#e43b44' };

// [x, y, color] for every lit pixel.
/** @param {string[]} rows @returns {[number, number, string][]} */
export const badgePixels = (rows) => rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' ? [] : [[x, y, BADGE_COLORS[c]]])));

export function badgeSvg(rows) {
  const rects = badgePixels(rows).map(([x, y, fill]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`).join('');
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
