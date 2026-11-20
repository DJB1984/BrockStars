import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { FIGHTER_IDS } from '../fighters.js';
import { installFrames } from './pixel';
import { net, remember, remembered, type Session } from './session';
import { FindGame } from './FindGame';
import { ChooseFighter } from './ChooseFighter';
import { enterFullscreen, offerFullscreen } from './fullscreen';

// The screens before the game: find or make a game, then choose a fighter. On a phone, pressing Play also
// offers full screen, over the fighter pick.

type Props = {
  level: string;
  initialCharacter?: string;
  initialSession?: Session;   // already in a game (the in-game menu's Change fighter): start on the pick
  onDone: (result: { character: string; cancelled?: boolean }) => void;
};

export function Lobby({ level, initialCharacter, initialSession, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session | null>(initialSession ?? null);
  const fromGame = useRef(!!initialSession);
  const savedChar = initialCharacter ?? remembered('brockstars.char', FIGHTER_IDS[0]);
  const [character, setCharacter] = useState(FIGHTER_IDS.includes(savedChar) ? savedChar : FIGHTER_IDS[0]);
  const [askFullscreen, setAskFullscreen] = useState(false);

  useEffect(() => { if (root.current) installFrames(root.current); }, []);

  // The host closed the game while you were still choosing: back to finding one.
  useEffect(() => {
    if (!session) return;
    const ended = () => setSession(null);
    net.on('ended', ended);
    return () => { net.off('ended', ended); };
  }, [session]);

  const back = () => {
    // Opened from the fight: Back goes back to it, still in the same game, as the same fighter.
    if (fromGame.current) {
      onDone({ character, cancelled: true });
      return;
    }
    net.end('left');
    setSession(null);
  };

  // Once the game you came from is gone, this is the ordinary lobby again.
  useEffect(() => { if (!session) fromGame.current = false; }, [session]);

  const ready = (s: Session) => {
    setSession(s);
    if (offerFullscreen()) setAskFullscreen(true);
  };

  const fight = (id: string) => {
    remember('brockstars.char', id);
    setCharacter(id);
    onDone({ character: id });
  };

  return (
    <div ref={root} className="bs">
      <Sky />
      {session ? (
        <ChooseFighter session={session} initialId={character} onFight={fight} onBack={back} />
      ) : (
        <FindGame level={level} initialName={remembered('brockstars.name', '')} onReady={ready} />
      )}
      {session && askFullscreen && <FullscreenAsk onDone={() => setAskFullscreen(false)} />}
    </div>
  );
}

// Full screen or not, asked once after Play on a phone: just the two buttons. The Full screen tap is what lets the browser do it.
function FullscreenAsk({ onDone }: { onDone: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { yes.current?.focus(); }, []);
  // Esc just closes this; it shouldn't reach the pick screen behind it and leave the game
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onDone();
  };
  return (
    <>
      <div className="ask-scrim" onPointerDown={onDone} aria-hidden="true" />
      <section className="ask px-panel" role="dialog" aria-modal="true" aria-label="Play full screen?" onKeyDown={onKey}>
        <div className="ask-buttons">
          <button ref={yes} type="button" className="btn btn-ember btn-big" onClick={() => { enterFullscreen(); onDone(); }}>
            <span className="btn-face">Full screen</span>
          </button>
          <button type="button" className="btn btn-pine" onClick={onDone}>
            <span className="btn-face">Not now</span>
          </button>
        </div>
      </section>
    </>
  );
}

// Pixel sparkles on the stripes. Fixed positions (a seeded scatter) so they don't jump between renders.
function Sky() {
  const stars = useMemo(() => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 26 }, () => ({ x: rand() * 100, y: rand() * 100, s: rand() < 0.3 ? 2 : 1, d: rand() * 4 }));
  }, []);
  return (
    <div className="sky" aria-hidden="true">
      {stars.map((st, i) => (
        <i
          key={i}
          className={`spark spark-${st.s}`}
          style={{ left: `${st.x}%`, top: `${st.y}%`, animationDelay: `${st.d}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}
