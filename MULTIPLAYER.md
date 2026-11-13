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

All of them need PHP on the PATH (`php -v`); without it the game runs solo. URL options: `?level=brock3`
or `?solo` skip the lobby (playtests use `?level`), `?quick` acts like `npm run local`, `?character=titus`.
In the browser console, `brockNet` shows the session (`brockNet.role`, `brockNet.players`).

## Deploying to HostGator

`dist/` is the whole site: upload its contents into the site's folder. `net.php` creates a `net-data/`
folder next to itself for the rooms (with an `.htaccess` that keeps it private). The site must be HTTPS.

- With SSH (shell access must be enabled by HostGator support): `deploy.config.json` (gitignored) is set
  up for the deploy-hostgator skill: `remotePath` `brockstars`, `siteUrl` https://brockstars.brookslanding.com.
- Without: `npm run package`, then in cPanel's File Manager upload `brockstars-site.zip` into the site's
  folder and Extract it.

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
- Up to 8 players per room. Players walk through each other; attacks and items aren't shared yet.
- Rooms close 15 seconds after the host stops checking in.
