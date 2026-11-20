# James

James uses the existing Mason/Titus four-frame walking rig and shared combat controller.
His charcoal Carhartt hoodie, cream/orange Dragons cap, broad build, and sneakers are
editable Pixel Forge text layers. James stands taller than Titus and Mason, with longer legs and a slimmer, solid torso.
His tall_topdown class uses a 64x80 canvas and feet origin (32,68);
all directions retain the shared four-frame walk cycle.

Movement: 110 px/s (Titus 140, Mason 180). Basic attacks, block, health, and cooldowns
use the shared rules unchanged. James has no special move assigned yet. Incoming
Titus takedowns use James's own fall, knockdown, and recovery poses.

- Select James in the lobby, or use the in-game menu’s **Change fighter** option.
- Solo: `http://localhost:5173/?solo&character=james`
- Practice: `http://localhost:5173/?practice=1&character=james`

Regenerate the layers with `node scripts/build-james.mjs`, then run
`node_modules/pixelforge-venv/Scripts/python.exe -m pixelforge export james`
and `node_modules/pixelforge-venv/Scripts/python.exe -m pixelforge gallery`.
The builder reads Mason's source rig and only writes `sprites/james/`.

Browser checks: `node tests/james-browser.mjs`; use `CHARACTER=james` with
`tests/combat-browser.mjs` for the full shared attack suite, and `HOST_CHARACTER=james`
with `tests/net-combat-browser.mjs` for multiplayer. The existing `PLAYWRIGHT_MODULE`
and `BROWSER_EXECUTABLE` environment options work for all three scripts.
