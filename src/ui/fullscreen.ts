import { useSyncExternalStore } from 'react';

// Full screen: the browser's bars go away and the game gets the whole screen. It has to start from a tap, so
// on a phone the lobby asks once Play is pressed, and the in-game menu can switch it on and off anywhere the
// browser allows it. iPhone Safari can't put a page full screen (only video), so there it's never offered.

type Doc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';   // as in Hud.tsx, with the same ?touch=1|0 override

const touchScreen = () => {
  const forced = new URLSearchParams(location.search).get('touch');
  return forced === '1' || (forced !== '0' && matchMedia(TOUCH_QUERY).matches);
};

export const isFullscreen = () => {
  const d = document as Doc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
};

export const canFullscreen = () => {
  const d = document as Doc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
};

export const offerFullscreen = () => touchScreen() && canFullscreen() && !isFullscreen();

export async function enterFullscreen() {
  const el = document.documentElement as El;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    // refused (or the browser changed its mind): keep playing in the browser
  }
}

export async function exitFullscreen() {
  const d = document as Doc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // already out
  }
}

export const toggleFullscreen = () => (isFullscreen() ? exitFullscreen() : enterFullscreen());

// Whether the page is full screen right now, also when the player leaves it with the back gesture or Esc.
const subscribe = (changed: () => void) => {
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('webkitfullscreenchange', changed);
  return () => {
    document.removeEventListener('fullscreenchange', changed);
    document.removeEventListener('webkitfullscreenchange', changed);
  };
};
export const useFullscreen = () => useSyncExternalStore(subscribe, isFullscreen);
