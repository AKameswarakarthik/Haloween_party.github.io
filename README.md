cp halloween.html index.html # COMPANY — Event Announcement Pages

Pure front-end. No build step, no backend, no npm install.

## Pages

| Page | File | Status |
|---|---|---|
| Halloween Night | `halloween.html` | done |
| _(page 2)_ | — | not started |

## Running it

Open `halloween.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8123
```

Then visit http://localhost:8123/halloween.html

Everything is plain `<script>` tags (no ES modules), so `file://` works too.

## Structure

```
halloween.html        markup: brand, hanging ghosts, scroll track, game layer
css/halloween.css     the funky-spooky theme, ghosts, HUD, overlays
js/pumpkin.js         shared 3D builders: jack-o'-lantern, ghost, glow sprite
js/hero.js            scroll-driven hero scene (the lantern)
js/game.js            "PUMPKIN RUN" — the 3-lane endless runner
js/main.js            scroll orchestration + handover to the game
```

Only external dependency: three.js r128 from cdnjs.

## How the scroll works

`main.js` maps `scrollY / maxScroll` to a 0..1 value and feeds it to `HW.hero.setProgress()`.
`hero.js` eases that value (frame-rate independent) and drives every beat from it:

| progress | what happens |
|---|---|
| 0.04 – 0.40 | the carved face lights up (emissive map + a point light inside the shell) |
| 0.38 – 0.76 | the lantern rotates 180° and turns its back on you |
| 0.76 – 1.00 | it lifts away, the camera follows it up |
| ≥ 0.965 | the game layer takes over |

The carved face is a canvas-drawn texture used as an `emissiveMap`, so at
`emissiveIntensity: 0` the pumpkin is just a dark gourd, and the face only
exists once it's lit. Sphere UVs put `u = 0.25` at +Z, which is why the face is
drawn a quarter of the way across the canvas.

While the game is live, wheel/touchmove are blocked rather than setting
`overflow: hidden`, so the scroll position survives; "leave the woods" (or Esc)
returns you to the announcement.

## The game

Temple-Run-style: three lanes, a pumpkin-headed runner, a ghost that never stops.

- `←` `→` switch lane, `↑`/`space` jump, `↓` slide. Swipes on touch.
- **fire** — jump it. **spider web** — slide under it. **sudden ghost** — appears
  with a warning marker; the only way past is a lane change.
- **candy corn** pushes the ghost back; hitting an obstacle lets it gain.
- When the gap runs out the ghost catches you and the pumpkin head detonates.

Balance knobs are the constants at the top of `js/game.js` (`SPEED_*`, `GAP_*`,
`JUMP_V`, spawn spacing in `spawn()`).
