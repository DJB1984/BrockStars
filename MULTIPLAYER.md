# Multiplayer

Players' browsers play each other directly (WebRTC). The host's browser is the hub: joiners connect to
it, send where they are ~15 times a second, and get everyone back. The web host only serves the game and
`net.php`, a small PHP script that lists rooms and passes the connection handshake. No game traffic goes
through it, so it runs on HostGator's Hatchling plan with nothing else to pay for.

Everyone plays one shared game: the lobby's **Play** button joins room `BROCK` (`WORLD_ROOM`), and whichever
browser gets there first is its hub. When the hub's tab closes, the others reconnect within a second or two
and one of them takes over (`net.stay`). Private games still work (`net.host`, `net.join`), but their
controls (Host, Join by code, Games on your Wi-Fi) are hidden: set `PRIVATE_GAMES` in `src/ui/FindGame.tsx`
to bring them back. The home screen shows how many are in the shared game (`net.php?action=world`).

| | |
|---|---|
| `server/net.php` | matchmaking: rooms, join codes, games on your network, the handshake |
| `src/net/session.js` | `net`: host / join / quick / stay, the WebRTC connections, everyone's state |
| `src/net/remotes.js` | draws the other players in the level (smoothed, with name tags) |
| `src/ui/` | the start screen: name and Play (the shared game), then the fighter |

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
network may block direct connections between devices." The fix is a TURN relay: when two players can't
reach each other, their traffic goes through it instead (the relay is tried only after a direct connection
fails, so home games stay direct).

Cloudflare's TURN is free for the first 1,000 GB a month, which is far more than this game uses, and it
listens on port 443 over TLS, which campus firewalls let through like ordinary HTTPS:

1. In the Cloudflare dashboard, open **Realtime → TURN Server** and create a TURN key. Copy its
   **Turn Token ID** and **API Token** (the token is shown once).
2. On the server, create `net.config.php` next to `net.php` (deploys don't overwrite it):
   ```php
   <?php return ['cloudflare' => ['key_id' => 'TURN_TOKEN_ID', 'token' => 'API_TOKEN']];
   ```
`net.php` asks Cloudflare for credentials that last a day and gives them to players for 12 hours (cached
in `net-data/turn.json`), so the API token never reaches a browser. If Cloudflare can't be reached it logs
`[net] Cloudflare TURN: ...` to the PHP error log and waits 5 minutes before trying again. Players still get
STUN in the meantime. To check it, host a game and run `brockNet.ice` in the browser console: it should
list `turn.cloudflare.com`.

Any other TURN server works too, with fixed credentials:

```php
<?php return [['urls' => 'turn:relay.example.com:3478', 'username' => 'user', 'credential' => 'pass']];
```

## Limits

- The host's tab is the game. In the shared game and on `npm run local`, another tab takes over when it
  closes (everyone blinks out for a second or two); a private hosted game ends for everyone. A hidden host tab gets throttled by the browser, so others see it update slowly.
- Up to 16 players in the shared game and 8 in a private one. The hub sends every player to every other
  player, so its upload grows with the square of the players: past ~16 it needs a real game server. Players walk through each other; items aren't shared yet.
- Rooms close 15 seconds after the host stops checking in.

## Shared combat

Mason and Titus can fight other players in the same level: C punches, X kicks, Z headbutts,
holding V blocks every side but the one behind you, and Shift dodges (or WASD with J, K, L, I and Space, picked in
the menu's Controls). The host checks attack
range, timing, cooldowns, and blocking, then shares damage, health, hit effects, and knockback.
Each attack can hit each opponent once. Health regenerates after 45 seconds without damage;
a knockout respawns the player after a short pause. Other players' name tags display their health.

Each hit the host shares names its move (`punch`, `grapple`...) and how far and how long the victim slides, and
the snapshot says which way a staggered fighter flinched (`hurtFacing`). Every screen then makes the hit felt
the same way (`src/combat/hitFeel.js`): the two fighters freeze for a moment, the victim shakes in its hurt pose,
a spark pops at the contact point, and only the two people in the fight feel the camera shake. A swing that
connects with nobody swishes instead.

Combat commands and results use an ordered, reliable WebRTC channel. Movement still sends about
15 snapshots a second. Both players need the updated game files; refresh older open tabs after deploying.
Movement remains client-controlled.

**Lag compensation.** Every screen draws the other players about 110 ms in the past (`DELAY_MS` in
`src/net/remotes.js`), so the host doesn't judge an attack against where people are now: it keeps a second of
everyone's positions and judges it against where they stood at the moment the attacker's screen showed. Each
snapshot carries the host's clock (`t`), each remote position remembers the snapshot it came from, and an
attack command carries `seen`, the host time the attacker was looking at (`RemotePlayers.seenTime()`). The host
rewinds that far, at most `MAX_REWIND` (300 ms), with `TOLERANCE` (40 ms) either side for the smoothing
(`src/net/combat.js`). Clients still never send damage; they do say when they saw the world, which a cheater
could stretch by up to 300 ms. Among friends that's the right trade: a swing that clearly connected and then
missed feels worse than the rare hit just after someone stepped out of range.

**Your own hits feel instant.** When your swing visibly reaches another player on your screen, the freeze and
spark play right away (`Level.predictHit`); the host's answer, a round trip later, brings only the damage and
isn't felt a second time. If the host disagrees, the damage just doesn't happen.

**Reading the fight** (`src/combat/fightMarks.js`): a ring at everyone's feet (amber for you, red for the
others) with a second, pulsing ring while their Super is ready (the snapshot's `<move>Cooldown`); a white glint
as a headbutt or a Super winds up (their hit zones stay hidden); a shield arc on a block, flashing when it stops a
hit. A hit from someone you can't see puts a red arrow on your screen's edge, pointing
at them. The HUD shows every move's cooldown, and a move pressed too early wiggles its keycap and clicks.

**Controls that forgive** (`src/combat/rules.js`, `src/net/combat.js`): a press made up to `BUFFER_MS` (150 ms)
before a fighter is free fires the moment it is, on the client and again on the host, which holds a command that
arrives a moment before it thinks the last move ended. A tap with no arrow held turns toward the nearest opponent
(`aimFacing`); the facing chosen is the one sent. A hit in the first 120 ms of a block (`BLOCK.perfect`) does no
damage: the host sends that hit (`perfect`) and a `parry` hit that staggers the attacker. A `dodge` command makes
the host ignore hits on that player for 150 ms; the movement itself stays the client's, and its snapshot carries
`dodge` so the others draw the afterimages. A player held in a Grapple or stunned by a Bellow sends `mash` on each
fresh press; the host takes 120 ms off the hold (never under 600 ms) or 150 ms off the stun (never under 1 s),
counts presses no closer than 50 ms, and won't let anyone grab a freed player again for a second.

Run `npm test` for combat rules and host authority checks, and `npm run test:multiplayer` against
`npm run dev` to exercise two browser clients (Playwright and Chrome/Chromium required).
`npm run test:hitfeel` and `npm run test:hitfeel:multiplayer` check that hits land and misses swish, solo and online.
`npm run test:readable` and `npm run test:readable:multiplayer` check the rings, telegraphs, shields, keycaps and
dud presses, and online the `seen` time, the predicted hit felt once, and the off-screen arrow.
`npm run test:controls` and `npm run test:controls:multiplayer` check the buffer, tap aim, perfect and three-sided
blocks, the dodge, mashing out, both keyboard layouts and touch aiming, solo and online.
