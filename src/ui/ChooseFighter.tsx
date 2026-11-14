import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { FIGHTERS } from '../fighters.js';
import { ATTACKS, BLOCK, REGEN } from '../combat/rules.js';
import { net, type Session } from './session';
import { Sprite, preloadSprite } from './Sprite';
import { Icon, Platform } from './Icon';

// Phase two: the fighter stands on the left (arrows or ← → to switch), their stats sit on a card on the
// right, and FIGHT! drops you into the level. Anyone can pick any fighter, even one a friend is playing.

type Fighter = (typeof FIGHTERS)[number];

// UI-only: each fighter's color behind them on the stage, taken from their sprite
const ACCENT: Record<string, string> = { mason: '#feae34', titus: '#0099db' };
const MAX_SPEED = 200;
const MAX_DAMAGE = 10;
const HEALTH = 100;

const MOVES = [
  { name: 'Punch', ...ATTACKS.punch },
  { name: 'Kick', ...ATTACKS.kick },
  { name: 'Headbutt', ...ATTACKS.headbutt },
];

type Props = { session: Session; initialId: string; onFight: (id: string) => void; onBack: () => void };

export function ChooseFighter({ session, initialId, onFight, onBack }: Props) {
  const start = Math.max(0, FIGHTERS.findIndex((f) => f.id === initialId));
  const [index, setIndex] = useState(start);
  const [dir, setDir] = useState<'left' | 'right' | 'none'>('none');
  const [fighting, setFighting] = useState(false);
  const [count, setCount] = useState(net.count);
  const narrow = useNarrow();
  const f: Fighter = FIGHTERS[index];

  useEffect(() => { FIGHTERS.forEach((x) => preloadSprite(x.id)); }, []);

  useEffect(() => {
    const update = () => setCount(net.count);
    net.on('players', update);
    return () => { net.off('players', update); };
  }, [session.mode]);

  const go = useCallback((step: number) => {
    if (fighting) return;
    setDir(step > 0 ? 'right' : 'left');
    setIndex((i) => (i + step + FIGHTERS.length) % FIGHTERS.length);
  }, [fighting]);

  const pick = (i: number) => {
    if (fighting || i === index) return;
    setDir(i > index ? 'right' : 'left');
    setIndex(i);
  };

  const fight = useCallback(() => {
    if (fighting) return;
    setFighting(true);
  }, [fighting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); go(1); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); fight(); }
      else if (e.key === 'Escape') onBack();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [go, fight, onBack]);

  const speedCells = Math.round((f.speed / MAX_SPEED) * 10);
  const stageStyle = { '--accent': ACCENT[f.id] ?? '#feae34' } as CSSProperties;

  return (
    <main className={`pick${fighting ? ' is-fighting' : ''}`} style={stageStyle}>
      <header className="pick-head">
        <button type="button" className="btn btn-slate btn-small back" onClick={onBack} disabled={fighting}>
          <span className="btn-face"><Icon name="back" size={2} /> Back</span>
        </button>
        <h1 className="pick-title">Choose your fighter</h1>
        <RoomBadge session={session} count={count} />
      </header>

      <section className="stage" aria-roledescription="carousel" aria-label="Fighters">
        <div className="stage-rays" aria-hidden="true" />
        <button type="button" className="arrow arrow-left btn btn-gold" onClick={() => go(-1)} aria-label="Previous fighter" disabled={fighting}>
          <span className="btn-face"><Icon name="right" size={4} flip /></span>
        </button>

        <div className="stage-spot">
          <div className="stage-floor" aria-hidden="true">
            <Platform w={44} h={10} size={narrow ? 4 : 6} top="#5a6988" fill="#262b44" rim="#181425" />
          </div>
          <div key={`${f.id}-${fighting}`} className={`stage-fighter enter-${dir}`}>
            <Sprite
              id={f.id}
              anim={fighting ? 'punch_down' : 'idle_down'}
              loop={!fighting}
              onEnd={() => onFight(f.id)}
              scale={narrow ? 4 : 6}
              className="stage-sprite"
              label={f.fullName}
            />
          </div>
        </div>

        <button type="button" className="arrow arrow-right btn btn-gold" onClick={() => go(1)} aria-label="Next fighter" disabled={fighting}>
          <span className="btn-face"><Icon name="right" size={4} /></span>
        </button>

        <div key={f.id} className="stage-name" aria-live="polite">
          <span className="stage-name-big">{f.fullName}</span>
        </div>

        <ol className="roster" aria-label="Roster">
          {FIGHTERS.map((x, i) => (
            <li key={x.id}>
              <button
                type="button"
                className={`roster-slot${i === index ? ' is-on' : ''}`}
                aria-pressed={i === index}
                aria-label={x.name}
                onClick={() => pick(i)}
                disabled={fighting}
              >
                <Sprite id={x.id} scale={2} crop={[16, 2, 32, 26]} />
                {i === index && <span className="roster-cursor" aria-hidden="true">P1</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <aside className="card px-panel" aria-label={`${f.name}’s stats`}>
        <div key={f.id} className="card-body">
          <div className="card-head">
            <h2 className="card-name">{f.fullName}</h2>
          </div>

          <dl className="stats">
            <div className="stat">
              <dt>Speed</dt>
              <dd>
                <Meter cells={speedCells} />
                <span className="stat-num">{f.speed}<small>{f.trait}</small></span>
              </dd>
            </div>
            <div className="stat">
              <dt>Health</dt>
              <dd>
                <Meter cells={10} tone="green" />
                <span className="stat-num">{HEALTH}<small>Heals after {REGEN.delay / 1000}s</small></span>
              </dd>
            </div>
          </dl>

          <h3 className="card-sub">Moves</h3>
          <ul className="moves">
            {MOVES.map((m) => (
              <li key={m.name} className="move">
                <kbd className="key">{m.key}</kbd>
                <span className="move-name">{m.name}</span>
                <span className="dmg" aria-label={`${m.damage} damage`}>
                  {Array.from({ length: MAX_DAMAGE }, (_, i) => <i key={i} className={i < m.damage ? 'on' : ''} />)}
                </span>
                <span className="move-num">{m.damage}</span>
              </li>
            ))}
            <li className="move">
              <kbd className="key">V</kbd>
              <span className="move-name">Block <small>hold</small></span>
              <span className="move-note">Takes {Math.round(BLOCK.reduction * 100)}% less damage</span>
            </li>
          </ul>

          <div className={`special${f.special.ready ? '' : ' is-soon'}`}>
            <div className="special-head">
              <h3 className="card-sub">Special <span className="special-name">{f.special.name}</span></h3>
              {!f.special.ready && <span className="stamp">Coming soon</span>}
            </div>
            <p className="special-text">{f.special.text}</p>
          </div>
        </div>
      </aside>

      <footer className="pick-go">
        <button type="button" className="btn btn-gold btn-huge fight" onClick={fight} disabled={fighting}>
          <span className="btn-face">Fight!</span>
        </button>
      </footer>

      {fighting && <div className="flash" aria-hidden="true" />}
    </main>
  );
}

const NARROW = '(max-width: 860px)';
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const update = () => setNarrow(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

function Meter({ cells, tone = 'gold' }: { cells: number; tone?: 'gold' | 'green' }) {
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < cells ? 'on' : ''} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

function RoomBadge({ session, count }: { session: Session; count: number }) {
  return (
    <div className="room-badge">
      <span className="room-badge-label">{session.mode === 'host' ? 'Friends join with' : 'Room'}</span>
      <span className="room-badge-code">{session.room}</span>
      <span className="room-badge-count"><Icon name="person" size={2} /> {count} in game</span>
    </div>
  );
}
