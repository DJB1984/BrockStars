// Typed view of the multiplayer session (src/net/session.js) and matchmaking (src/net/signal.js), for the UI.
import { net as rawNet, WORLD_ROOM as RAW_WORLD_ROOM } from '../net/session.js';
import { call } from '../net/signal.js';

type Net = {
  readonly room: string | null;
  readonly role: 'host' | 'client' | null;
  readonly active: boolean;
  readonly count: number;   // players in the level, you included
  host(o: { name: string; level: string }): Promise<unknown>;
  join(o: { name: string; room: string }): Promise<unknown>;
  stay(o: { name: string; level: string; room: string }): Promise<unknown>;
  end(reason: string): void;
  on(event: 'players' | 'ended', fn: () => void): unknown;
  off(event: 'players' | 'ended', fn: () => void): unknown;
};

export const net = rawNet as unknown as Net;
export const WORLD_ROOM = RAW_WORLD_ROOM as string;

export type RoomInfo = { room: string; host: string; players: number };
export const listRooms = async () => ((await call('rooms')) as { rooms: RoomInfo[] }).rooms;
export const worldPlayers = async () => ((await call('world')) as { players: number }).players;

export type Session =
  | { mode: 'world'; room: string }
  | { mode: 'host'; room: string }
  | { mode: 'join'; room: string };

export const remembered = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
export const remember = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
};
