import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FIGHTER_IDS } from '../fighters.js';
import { listRooms, net, remember, worldPlayers, WORLD_ROOM, type RoomInfo, type Session } from './session';
import { HeadingToBrock } from './HeadingToBrock';

// Phase one: a name, then Play: everyone is in one shared game.
// (Solo play skips the lobby: ?solo in the URL.)

const REFRESH_MS = 3000;
const MAX_PLAYERS = 8;
// The trip to Brock stays up at least this long, so a fast connection doesn't just flash it.
const TRIP_MIN_MS = 1800;
// Private games (Host, Join by code, Games on your Wi-Fi) still work in src/net; their controls are hidden
// while everyone plays together. true brings them back.
const PRIVATE_GAMES = false;

// A random fighter walks you there, a different one each time you load in.
const tripFighter = () => FIGHTER_IDS[Math.floor(Math.random() * FIGHTER_IDS.length)];

type Props = { level: string; initialName: string; onReady: (session: Session) => void };

export function FindGame({ level, initialName, onReady }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [online, setOnline] = useState<number | null>(null);   // in the shared game; null until known
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  const [busy, setBusy] = useState(false);
  const [trip, setTrip] = useState<string | null>(null);   // the fighter walking, while heading to Brock
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!initialName) nameRef.current?.focus(); }, [initialName]);

  useEffect(() => {
    let live = true;
    const refresh = () => worldPlayers().then((n) => live && setOnline(n)).catch(() => live && setOnline(null));
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!PRIVATE_GAMES) return;
    let live = true;
    const refresh = () => listRooms().then((r) => live && setRooms(r)).catch(() => live && setRooms((old) => old ?? []));
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  const checkName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus({ text: 'Pick a name first.', error: true });
      nameRef.current?.focus();
      return null;
    }
    remember('brockstars.name', trimmed);
    return trimmed;
  };

  const run = async (what: string, fn: (name: string) => Promise<Session>) => {
    if (busy) return;
    const player = checkName();
    if (!player) return;
    setBusy(true);
    setStatus({ text: what });
    try {
      onReady(await fn(player));
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
      setBusy(false);
      setTrip(null);
    }
  };

  const play = () => run('Heading to Brock…', async (player) => {
    setTrip(tripFighter());
    const minimum = new Promise((done) => setTimeout(done, TRIP_MIN_MS));
    await Promise.all([net.stay({ name: player, level, room: WORLD_ROOM }), minimum]);
    return { mode: 'world', room: net.room ?? WORLD_ROOM };
  });

  const host = () => run('Opening a room…', async (player) => {
    await net.host({ name: player, level });
    return { mode: 'host', room: net.room ?? '' };
  });

  const join = (room: string) => run(`Joining ${room}…`, async (player) => {
    await net.join({ name: player, room });
    return { mode: 'join', room: net.room ?? room };
  });

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const room = code.trim().toUpperCase();
    if (!room) {
      setStatus({ text: 'Type the code from the host’s screen.', error: true });
      codeRef.current?.focus();
      return;
    }
    join(room);
  };

  return (
    <main className={`find${busy ? ' is-busy' : ''}`}>
      <header className="find-title">
        <h1 className="logo">
          <span className="logo-brock">Brock</span>
          <span className="logo-stars">Stars</span>
        </h1>
      </header>

      <section className="find-panel px-panel" aria-label="Find a game">
        <label className="field">
          <span className="field-label">Player name</span>
          <span className="px-field">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={16}
              autoComplete="nickname"
              spellCheck={false}
              placeholder="Your name"
            />
          </span>
        </label>

        <button type="button" className="btn btn-ember btn-big" onClick={play} disabled={busy}>
          <span className="btn-face">Play</span>
        </button>

        <p className={`online${online ? ' is-live' : ''}`} role="status" aria-live="polite">
          {online === null ? ' ' : online === 0 ? 'Nobody on yet. Be the first!'
            : <><i className="online-dot" aria-hidden="true" />{online} {online === 1 ? 'player' : 'players'} online</>}
        </p>

        {PRIVATE_GAMES && (
          <>
            <button type="button" className="btn btn-pine btn-big" onClick={host} disabled={busy}>
              <span className="btn-face">Host a game</span>
            </button>

            <form className="join-row" onSubmit={submitCode} autoComplete="off">
              <span className="px-field">
                <input
                  ref={codeRef}
                  className="code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={8}
                  placeholder="CODE"
                  aria-label="Room code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                />
              </span>
              <button type="submit" className="btn btn-brick" disabled={busy}><span className="btn-face">Join</span></button>
            </form>

            <section className="nearby" aria-labelledby="nearby-title">
              <h2 id="nearby-title" className="nearby-title">Games on your Wi-Fi</h2>
              {!rooms || rooms.length === 0 ? (
                <div className="room room-empty" role="status" aria-label="Looking for games on your Wi-Fi">
                  <span className="scan" aria-hidden="true"><i /><i /><i /></span>
                </div>
              ) : (
                <ul className="rooms">
                  {rooms.map((r) => (
                    <li key={r.room} className="room">
                      <span className="room-host">{r.host}’s game</span>
                      <span className="room-meta">
                        <span className="room-code">{r.room}</span>
                        <span className="pips" aria-label={`${r.players} of ${MAX_PLAYERS} players`}>
                          {Array.from({ length: MAX_PLAYERS }, (_, i) => <i key={i} className={i < r.players ? 'on' : ''} />)}
                        </span>
                      </span>
                      <button type="button" className="btn btn-brick btn-small" onClick={() => join(r.room)} disabled={busy}>
                        <span className="btn-face">Join</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <p className={`status${status.error ? ' is-error' : ''}`} role="status">{status.text}</p>
      </section>

      {trip && <HeadingToBrock fighter={trip} />}
    </main>
  );
}
