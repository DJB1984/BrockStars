// The matchmaking server: net.php next to the page (server/net.php, copied into dist/ by the build; the
// dev server proxies it to a local `php -S`). It only introduces players; the game itself goes peer to peer.

const ENDPOINT = 'net.php';

export class SignalError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// call('rooms') is a GET; call('join', {...}) POSTs JSON. Resolves with the reply, or throws a SignalError
// whose `code` says why (no-room, taken, full, offline, server...).
export async function call(action, body) {
  let res;
  try {
    res = await fetch(`${ENDPOINT}?action=${action}`, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new SignalError("Can't reach the game server.", 'offline');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new SignalError(`The game server isn't answering (${res.status}).`, 'server');
  if (data.error) throw new SignalError(data.error, data.code);
  return data;
}

// Fire-and-forget for when the page is closing (fetch may not finish then).
export function beacon(action, body) {
  navigator.sendBeacon?.(`${ENDPOINT}?action=${action}`, new Blob([JSON.stringify(body)], { type: 'text/plain' }));
}

// Handshake messages travel base64-encoded, so web filters on shared hosting don't trip over raw SDP.
export const pack = (message) => btoa(JSON.stringify(message));
export const unpack = (text) => JSON.parse(atob(text));
