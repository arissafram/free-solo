# Free Solo — plan

Chrome-dino-style climbing game. One flat gray, white bg, chunky pixels. Phone + desktop.
Reuse setup from `../mikes-dildos` (Phaser, index.html/style.css, swipe + short-screen handling, tools/serve.py). Don't copy dino art/game logic.

## Rules
- Endless: one wall that goes up forever. Rocks get faster and more frequent the longer you climb, with no end: the ramp hits the old hardest settings at 90s (`RAMP_MS`), then keeps rising at 0.35x (`AFTER_RAMP`) until each knob hits its limit (rock every 0.35s, 900px/s, 0.4s warning).
- Wall: 9 columns (`COLS` × `COL_W` = 810px), capped so phone and desktop play alike. The board fills the window: on a phone the wall runs off both sides and the camera follows the climber sideways (dead zone in the middle); on a wide window the wall is centred (no edge lines). Holds nudged off-grid (`JITTER_X` 12, `JITTER_Y` 18) so reach distance varies. Rows are built as you climb; besides the route, each column has a 35% → 15% chance of a hold (about 3–4 per row).
- Start: on the ground, both hands on lowest hold, random pose (sit start, drop knee, flag, heel hook, chalking, staring up, stretching). No speech bubble. No title. First swipe starts.
- Move: swipe / arrow keys = move one hand to the next hold in that direction (up/down/left/right). Only onto real holds. Hands share one hold or sit on adjacent holds, never further. Every reach takes 120ms (`MOVE_MS`), however far, so he climbs at a steady pace. Feet are cosmetic.
- Hazards: "!" flashes atop a column you can see, then a rock drops down it. No crumbling floor.
- Lose: hit by a rock → he falls to the ground, "GAME OVER", height reached, tap to climb again.
- Score: highest row reached, 1 row = 1m. Climbing down doesn't cost points. Best saved (`freesolo-best-m`), shown as `HI 42m  37m`.

## Phases (one session each)
_Pivot during phase 4 (user request): endless climb + crumble → levels, no crumble, a rock hit knocks you to the ground = game over._
_Pivot after playtest (branch `endless`): levels → endless again (no crumble), full-window board with a wider wall and sideways camera, height score._
1. **Gray box** — scaffold from dino repo; boxes for holds/climber/rocks; swipe+arrow movement between holds; scroll; "!" + falling rocks; crumble; game over + restart. Done = playable on phone + desktop.
2. **Tune** — spacing, gaps, fall speed, crumble speed, difficulty ramp. Constants at top of game.js.
3. **Hands + reach** — two-hand rule, off-grid holds, slow long reaches.
4. **Sprites** — text-grid sprites (like dino `tools/`), 2 frames each: hang, reach, fall; start poses, "hi", chalk puffs, burial pile.
5. **Polish** — screen shake, sound, best score, favicon. Done: shake + WebAudio blips, best level saved, `node tools/make_icons.js` builds favicon/apple-touch icon. Local only, no deploy. Sounds later removed (silent game).

## Ideas to try if holds still feel confusing
- Mark the holds each arrow would grab (dim ticks).
- Simpler hand rule: up moves whichever hand has the most straight-up hold, not always the lower hand.
