import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FIGHTER_IDS } from '../fighters.js';
import { installFrames } from './pixel';
import { net, remember, remembered, type Session } from './session';
import { FindGame } from './FindGame';
import { ChooseFighter } from './ChooseFighter';

// The screens before the game: find or make a game, then choose a fighter.

type Props = { level: string; initialCharacter?: string; onDone: (result: { character: string }) => void };

export function Lobby({ level, initialCharacter, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const savedChar = initialCharacter ?? remembered('brockstars.char', FIGHTER_IDS[0]);
  const [character, setCharacter] = useState(FIGHTER_IDS.includes(savedChar) ? savedChar : FIGHTER_IDS[0]);

  useEffect(() => { if (root.current) installFrames(root.current); }, []);

  // The host closed the game while you were still choosing: back to finding one.
  useEffect(() => {
    if (!session || session.mode === 'solo') return;
    const ended = () => setSession(null);
    net.on('ended', ended);
    return () => { net.off('ended', ended); };
  }, [session]);

  const back = () => {
    if (net.active) net.end('left');
    setSession(null);
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
        <FindGame level={level} initialName={remembered('brockstars.name', '')} onReady={setSession} />
      )}
    </div>
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
