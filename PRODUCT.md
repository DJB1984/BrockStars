# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- Game: Phaser 3.90 + Vite, plain JavaScript (`src/`), art authored with pixelforge (`sprites/`, `levels/`, exported to `export/`).
- Login / pre-game UI: **React + TypeScript**, confined to its own UI layer over the Phaser canvas. Phaser code stays JavaScript. Chosen because the room list polls, the screens hold real state, and typed fighter data has to grow from 2 fighters to the 8 in the design doc.
- Multiplayer: WebRTC peer-to-peer, the host's browser is the hub; `server/net.php` handles rooms, join codes and the handshake (see `MULTIPLAYER.md`). Static `dist/` deployed to HostGator shared hosting at https://brockstars.brookslanding.com.

## Users

A group of friends from Brock Hall, the dorm the game is set in. The fighters are based on them. They open the site together, often on the same campus Wi-Fi, to brawl each other. They use laptops and phones, so the login screens must work on both.

## Product Purpose

BrockStars is a top-down multiplayer brawler set in a pixel-art recreation of Brock Hall. Friends play as each other, pick a fighter, and fight in the halls and rooms. Success is a group getting from "open the link" into a shared fight in seconds, and wanting to come back.

## Positioning

A fighting game made by and about one friend group. The roster is real people with their own quirks (Mason the fast cowboy spy, Titus the all-rounder), and the map is their real dorm, drawn from floor plans and photos. No generic brawler can copy that.

## Operating Context

- **Phase 1, find or make a game:** enter a name, then host a room (gets a join code), join by code, join a game listed on the same network, or play solo. Rooms hold up to 8 players and close 15 s after the host leaves.
- **Phase 2, pick a fighter:** after joining, each player picks on their own and drops straight into the level. There is no shared waiting room and no host "start" step. The pick screen shows the fighter on the left with arrows to cycle through the roster, and a stat card on the right.
- Players often sit in the same room on the same Wi-Fi. Campus networks can block direct connections; TURN relay covers that (`MULTIPLAYER.md`).
- The existing lobby (`src/lobby.js`, `src/lobby.css`) is the incumbent version of phase 1 and the fighter choice. The new UI replaces it, keeping its functions: remembered name and character, URL options (`?solo`, `?level=`, `?character=`, `?quick`), and the status and error messages.

## Capabilities and Constraints

- **Roster: only the fighters that are built, currently Mason and Titus.** Don't list the other six from the design doc until they exist in the game.
- **Stat card: real stats plus the planned special.** Show what the code actually defines, and mark the design doc's special ability as coming soon until it's implemented:
  - Speed: Mason 180, Titus 140 (`src/scenes/Level.js`). Design doc traits: Mason "Fast", Titus "Normal".
  - Shared moves (`src/combat/rules.js`): Punch (C) 4 dmg, Kick (X) 6 dmg, Headbutt (Z) 10 dmg, Block (V, hold) cuts 75% of damage. Health 100, regenerates after 45 s without damage.
  - Planned specials (`Brocktopia/Davis Brock Fighter Game…pdf`): Mason, Grapple (slow choke hold, massive damage, long cooldown); Titus, Leg Sweep (knocks the opponent down, medium damage). Neither is built.
  - Mason's design doc profile: "Russian spy/agent". His sprite is a cowboy agent.
- Fighter sprites are pixelforge exports (`export/mason.png|json`, `export/titus.png|json`; top-down class, 64×64, idle/walk/attack in down/up/side). The pick screen should show these real sprites.
- Combat controls are keyboard only today. There are no in-game touch controls, so phones can get through login, but playing on a phone is an **open decision**.
- Two players picking the same fighter is currently allowed; nothing prevents it. Whether that should change is undecided.
- Hosting is static files plus one PHP script on shared hosting: no Node server, no database.

## Brand Commitments

- Name: **BrockStars**. Setting: Brock Hall.
- Pixel-art world in the Endesga 32 palette (`palettes/game.json`); the UI should feel pixelated to match.
- **Do not use the pixelforge bitmap fonts** in this UI (user directive).
- Fighters are portrayed affectionately. They are real friends, and the tone is inside-joke fun, not mean.

## Evidence on Hand

- Design doc with all 8 planned fighters, traits and specials: `Brocktopia/Davis Brock Fighter Game_261107_170149 (1).pdf`.
- Character concept art: `Brocktopia/Character Design/{Mason,Titus,Clayton} Character Design/`.
- Brock Hall reference photos and floor plans: `Brocktopia/Map Building/`.
- Playable sprites: `sprites/mason`, `sprites/titus`; level `levels/brock3.json` (Brock Hall 3rd floor).
- No player counts, testimonials or press exist; don't invent any.

## Product Principles

1. **Link to fight in seconds.** Every step between opening the site and being in a fight is a cost. Defaults (remembered name, last fighter, nearby games) carry the player through.
2. **Only show what's real.** The roster, stats and abilities shown match what the game actually does; planned things are labeled as planned.
3. **Built for the same room.** Join codes readable across a room, nearby games found without typing, and phone screens treated as first-class.
4. **The fighters are the stars.** Each friend's character should feel like a reveal, not a list item.
5. **Grows to eight.** Roster and stat structures must take the remaining six fighters without a redesign.

## Accessibility & Inclusion

- Login screens work at phone widths and with touch as well as mouse and keyboard; the fighter arrows also respond to keyboard arrows.
- Status and errors stay announced (`role="status"`), as in the incumbent lobby.
- No specific standard was set beyond that.
