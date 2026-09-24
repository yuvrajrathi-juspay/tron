# LIGHTWAKE

A neon light-cycle arena game in the browser: you against three bots, last rider standing.
Three arenas, keyboard or touch. Every model, shader, particle and sound is generated in code;
the only asset files are two UI fonts and the link-preview image.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Production build (static files in `dist/`, relative paths, so it can be hosted anywhere):

```bash
npm run build
npm run preview
```

**Before launching:** set your hosting URL in `.env` so Twitter/OG link previews show the image:
`VITE_SITE_URL=https://your-domain/lightwake/` (with the trailing slash), then `npm run build`.

It uses WebGPU and falls back to WebGL2 automatically. Add `?webgl` to force the fallback.
Share links can open an arena directly: `?map=grid`, `?map=mesa`, `?map=orbital`.

## Arenas

| Arena | Size | What's in it |
| --- | --- | --- |
| **THE GRID** | classic | Flat mirror floor: the pure light-cycle duel |
| **SUNDOWN MESA** | +50% | A raised mesa with four ramps (ride off its edges for big air), launch kickers, rolling dunes, boost pads, a Ghost pickup on the summit |
| **ORBITAL RIFT** | +50% | A space-station deck: rotating reactor lasers (jump them), void pits with launch kickers, corner-to-corner portals |

## Controls

| Keyboard | Touch | Action |
| --- | --- | --- |
| **W** | GAS | Throttle. Hold to ride; release and you coast down |
| **A / D** | ◀ ▶ | Steer. Slower bikes turn tighter |
| **S** | BRAKE | Brake, down to a full stop |
| **Shift** | BOOST | Boost (burns the meter) |
| **Space** | JUMP | Jump over a light wall (recharges in 7s) |
| **Esc / P** | II | Pause |
| **M** | — | Mute (touch: volume sliders in the pause menu) |

Touch controls appear automatically on phones and tablets (force them with `?touch`).
Keys follow physical positions, so WASD works on AZERTY/QWERTZ keyboards too.

## Rules

- Your cycle lays a solid wall of light that follows the terrain. Hitting a wall, a cliff, a laser or the barrier derezzes you, and so does falling into the void.
- **Stand still for 5 seconds and you derez.** A countdown warns you.
- Last rider standing: **+3**. Every rival who hits *your* wall: **+1**. First to **15** wins the match.
- Walls dissolve when their rider derezzes. Late in each round the barrier closes in.
- Boost refills when you **grind** alongside walls, pull **close calls**, land **big air**, or hit **boost pads**.
- Pickups: **BOOST** (full meter), **JUMP** (instant recharge), **GHOST** (ride through walls for 3.5s).

Rivals: **VOLT** (hunter), **NOVA** (survivor), **RAZE** (wildcard). The difficulty can be ROOKIE, PILOT (the default) or ACE.

## Code map

| File | What it does |
| --- | --- |
| `src/maps.js` | Arena definitions (pure data) |
| `src/terrain.js` | Height field, cliffs, pits, one-way hazard lines for the bots |
| `src/sim.js` | Rules: steering, gravity/jumps/landings, walls on slopes, pads, portals, pickups, lasers, scoring |
| `src/spatial.js`, `src/grid.js` | Spatial hash, collision/ray math, occupancy grid |
| `src/ai.js` | Bots: ray casts, flood-fill space checks, reaction lag, personalities, deliberate mistakes |
| `src/render/*` | WebGPU/TSL renderer: themed sky, arenas and features, the light cycle, sheared instanced light walls, GPU compute sparks, chase camera |
| `src/audio.js` | Web Audio synthesis: engines with Doppler, SFX, a per-arena synthwave score |
| `src/touch.js`, `src/input.js` | Touch buttons and keyboard, merged into one set of intents |
| `src/hud.js`, `src/mapdraw.js`, `index.html`, `src/style.css` | HUD, minimap, menus, map previews |
| `src/director.js`, `src/capture.js` | Trailer recording (only with `?capture`) |

## Tests and tools

```bash
npm test                                          # headless bot-vs-bot rules/balance on every arena
node test/playtest.mjs "http://127.0.0.1:5173/?map=mesa"   # real-keyboard playtest in Chrome
node test/touch-check.mjs                         # phone emulation: every touch button, both orientations
node test/soak.mjs 180                            # long autopilot soak: fps / heap / errors (MAP=orbital ...)
node test/maps-check.mjs grid,mesa,orbital menu,active-play   # screenshots + renderer stats
node test/record.mjs                              # re-record the 45s trailer to ~/Desktop (needs ffmpeg, dev server on :5188)
```

The page exposes `window.__THREE_GAME_TEST_HOOKS__` (`seed`, `setState`, `setMap`, `setPausedForScreenshot`) and
`window.__THREE_GAME_DIAGNOSTICS__`. Add `?autopilot` to let a bot drive your bike.
