# Mason Risner

Playable cowboy agent based on `Brocktopia/Character Design/Mason Character Design/Pixel Cowboy Agent Mason.png`.
Tan cowboy hat, sunglasses, black tactical clothing, gloves, boots, and a white/blue/red shoulder patch.
His fitted shirt shows defined pecs and abs; his slim build and walking stride follow Titus's proportions.

The character uses a 64 x 64 top-down canvas with feet at (32, 52). Editable pixel layers live in
`frames/`; `sprite.json` composes two idle frames and four walking frames for down, up, and side.
The existing player controller mirrors the side animation to face left.

Mason starts selected in the game. Move with WASD or arrow keys; choose Titus with 1 and Mason with 2,
or click their on-screen buttons. `?character=titus` starts with Titus. Mason's movement speed is 180
pixels/second compared with Titus's 140. Combat and the grapple ability are deferred.

Regenerate Mason's Phaser atlas and direction/walking previews with `python tools/export-mason.py`
using a Python environment with Pillow. This small exporter supports Mason's current layer/offset
compositions when the pixelforge CLI is unavailable. The standard project-wide `pixelforge export`
workflow can also consume the editable sprite source.
