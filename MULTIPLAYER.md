# Multiplayer

Players' browsers play each other directly (WebRTC). The host's browser is the hub: joiners connect to
it, send where they are ~15 times a second, and get everyone back. The web host only serves the game and
`net.php`, a small PHP script that lists rooms and passes the connection handshake. No game traffic goes
through it, so it runs on HostGator's Hatchling plan with nothing else to pay for.

| | |
|---|---|
| `server/net.php` | matchmaking: rooms, join codes, games on your network, the handshake |
| `src/net/session.js` | `net`: host / join / quick, the WebRTC connections, everyone's state |
| `src/net/remotes.js` | draws the other players in the level (smoothed, with name tags) |
| `src/lobby.js` | the start screen: name, character, host, join by code or from the list, solo |

## Running it

| command | what | URL |
|---|---|---|
| `npm run local` | test server: straight into Brock, no lobby. Every open tab joins room `LOCAL`, and other devices on your Wi-Fi can open the Network URL it prints | http://localhost:8001 |
| `npm run dev` | the real flow with the lobby | http://localhost:5173 |
| `npm run preview` | builds `dist/` and serves it with PHP, exactly what goes on HostGator | http://localhost:8002 |
| `npm run package` | builds `dist/` and zips it into `brockstars-site.zip` for cPanel's File Manager | |

The Vite dev servers need PHP: set `PHP_BIN` to its executable path, place a portable Windows copy at
`node_modules/php-runtime/php.exe`, or install PHP on the PATH (`php -v`). The portable copy is local to
this checkout and may be removed by `npm ci`. The PHP preview command needs PHP on the PATH.
Without PHP, use Play solo; hosting and joining require matchmaking. URL options: `?level=brock3`
or `?solo` skip the lobby (playtests use `?level`), `?quick` acts like `npm run local`, `?character=titus`.
In the browser console, `brockNet` shows the session (`brockNet.role`, `brockNet.players`).

## Deploying to HostGator

`dist/` is the whole site: upload its contents into the site's folder. `net.php` creates a `net-data/`
folder next to itself for the rooms (with an `.htaccess` that keeps it private). The site must be HTTPS.

The live site is https://brockstars.brookslanding.com, a subdomain whose document root is
`/home/brooksl2/public_html/website_1215fb1d` (HostGator picked that name).

- Over SFTP (works without shell access; the deploy key is in `~/.claude/deploy-hostgator.defaults.json`):
  `npm run build`, then upload `dist/*` into `public_html/website_1215fb1d/` (`sftp -P 2222 ... brooksl2@brookslanding.com`,
  `put -r dist/* public_html/website_1215fb1d/`). Old hashed files in its `assets/` can be deleted now and then.
- Or by hand: `npm run package`, then in cPanel's File Manager upload `brockstars-site.zip` into
  that folder and Extract it.

## When players can't connect

Players find each other with free STUN servers (Google, Cloudflare). That works on most home networks. Some
networks (campus Wi-Fi especially) block direct connections between devices; the joiner then sees "This
network may block direct connections between devices." The fix is a TURN relay: create
`net.config.php` next to `net.php` on the server (it isn't overwritten by deploys) returning its details:

```php
<?php return [['urls' => 'turn:relay.example.com:3478', 'username' => 'user', 'credential' => 'pass']];
```

## Limits

- The host's tab is the game: when it closes, the game ends for everyone (on `npm run local`, another
  tab takes over). A hidden host tab gets throttled by the browser, so others see it update slowly.
- Up to 8 players per room. Players walk through each other; items aren't shared yet.
- Rooms close 15 seconds after the host stops checking in.

## Shared combat

Mason and Titus can fight other players in the same level: C punches, X kicks, Z headbutts,
and holding V blocks the direction you faced when you started blocking. The host checks attack
range, timing, cooldowns, and blocking, then shares damage, health, hit effects, and knockback.
Each attack can hit each opponent once. Health regenerates after 45 seconds without damage;
a knockout respawns the player after a short pause. Other players' name tags display their health.

Combat commands and results use an ordered, reliable WebRTC channel. Movement still sends about
15 snapshots a second. Both players need the updated game files; refresh older open tabs after deploying.
The host validates combat against the latest reported positions; movement remains client-controlled.

Run `npm test` for combat rules and host authority checks, and `npm run test:multiplayer` against
`npm run dev` to exercise two browser clients (Playwright and Chrome/Chromium required).
