import { useEffect, useRef, useState, type FormEvent } from 'react';
import { listRooms, net, remember, type RoomInfo, type Session } from './session';

// Phase one: a name, then host a game, or join one by code or from the list of games on this Wi-Fi.
// (Solo play skips the lobby: ?solo in the URL.)

const REFRESH_MS = 3000;
const MAX_PLAYERS = 8;

type Props = { level: string; initialName: string; onReady: (session: Session) => void };

export function FindGame({ level, initialName, onReady }: Props) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!initialName) nameRef.current?.focus(); }, [initialName]);

  useEffect(() => {
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
    }
  };

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

        <button type="button" className="btn btn-gold btn-big" onClick={host} disabled={busy}>
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
          <button type="submit" className="btn btn-blue" disabled={busy}><span className="btn-face">Join</span></button>
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
                  <button type="button" className="btn btn-blue btn-small" onClick={() => join(r.room)} disabled={busy}>
                    <span className="btn-face">Join</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className={`status${status.error ? ' is-error' : ''}`} role="status">{status.text}</p>
      </section>
    </main>
  );
}
