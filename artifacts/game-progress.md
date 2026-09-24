# LIGHTWAKE: design and evidence

## Design brief
- **Player promise:** you are a light-cycle rider in a neon arena, carving walls of light to trap three rivals.
- **Primary verb:** steer (A/D, analog). **Secondary verbs:** throttle (W), brake (S), boost (Shift), jump (Space).
- **Every 5–30s:** read the open space, carve a line, cut off a rival or escape a closing pocket.
- **Across 1–5 min:** the arena fills with walls, sudden death shrinks it, and the score climbs toward 15.
- **Risk and reward:** grinding close to walls refills boost; cutting across a rival's nose scores kills. Both put you one mistake from derezzing.
- **Lose, learn, retry:** the death cam holds on your wreck, the feed shows who got you, and you spectate until the next round (about 3s).
- **Better players:** brake to tighten turns, grind for boost, save the jump for escapes, bait the hunter bot.
- **Non-goals:** online multiplayer, touch controls.

## Core loop contract
You steer to box in rivals while your own and their walls, the closing barrier and the 5-second idle rule create risk. A rival hitting your wall gives +1, surviving gives +3, and a crash costs you the round.

## Level plan
- A 184×184 square arena with a 16u tile grid, a central emblem, and corner pylons with sky beams as landmarks.
- Pinwheel spawn: all four riders start still, facing counter-clockwise, so nobody meets head-on.
- The first decision comes within seconds: which way to carve.
- Escalation: walls accumulate, then sudden death starts at 40s and shrinks the arena (faster once you're out). Dead riders' walls dissolve and act as recovery beats.
- Telegraphs: floor light pools under bikes, barrier glow that brightens near you, danger tint and siren in sudden death, the idle countdown.

## Verification (final pass, production build)
| Check | Result |
| --- | --- |
| Real-keyboard playtest (`test/playtest.mjs`) | Idle rule derezzed at 5.02s; W/A/D/Shift/Space/Esc all drive; pause freezes the sim; rounds advance; match end and rematch work; 60 fps median and 5th percentile; 0 errors |
| Soak, 120–180s autopilot | 60 fps min, heap stable (~40–60 MB), ≤ 271 draw calls, 0 errors |
| WebGL2 fallback (`?webgl`) | Same visuals, 60 fps, 0 errors |
| Canvas inspector (real Apple M5 Pro GPU) | colour entropy 4.2–7.3 bits, edge density 0.28–0.66, contrast 91–203, dominant colour ≤ 0.27; budgets: ≤ 167 calls, ≤ 100k triangles, 40 geometries, 18 textures |
| Headless balance (`npm test`) | Strong stand-in vs PILOT bots wins ~39% (fair odds are 25%); a ROOKIE-level stand-in wins ~18% |
| Audio levels (analyser tap) | Peaks 0.42–0.92, RMS about −20 dBFS, no clipping |

## Scorecard (visual-scorecard.md categories)
Art direction 2.5 · Hero (procedural light cycle with a sculpted shell, spinning glowing wheels, rider, reflections) 2.5 · Obstacles (light walls with a dissolve, shrinking barrier) 2 · Interactables (boost/jump/grind states, sparks, rings) 2 · World (grid floor, stands with a crowd, pylons, city, mountains, the Core ring) 2.5 · Materials 2 · Lighting/render (ACES, bloom, custom composite, mirror reflections) 2.5 · VFX (GPU compute sparks, debris, shockwaves, chromatic hit) 2.5 · UI/HUD 2.5 · Performance evidence 2.5. **Average ≈ 2.4**, no category below 2.

Measured evidence is in `artifacts/canvas-inspection/`.
