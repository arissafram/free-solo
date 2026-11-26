# Free Solo — plan

Chrome-dino-style climbing game. One flat gray, white bg, chunky pixels. Phone + desktop.
Reuse setup from `../mikes-dildos` (Phaser, index.html/style.css, swipe + short-screen handling, tools/serve.py, og tags). Don't copy dino art/game logic.

## Rules
- Wall: grid of holds (~4–5 cols) with gaps; holds nudged off-grid so reach distance varies. Wall scrolls up as you climb.
- Start: on the ground, both hands on lowest hold, random pose (sit start, drop knee, flag, heel hook, chalking, staring up, stretching), says "hi". No title. First swipe starts.
- Move: swipe / arrow keys = move one hand to the next hold in that direction (up/down/left/right). Only onto real holds. Hands share one hold or sit on adjacent holds, never further. Long reaches take longer. Feet are cosmetic.
- Hazards: "!" flashes atop a column, then rock/pigeon/phone drops down it. Bottom of wall crumbles upward.
- Lose: hit by object or caught by crumble → all rocks fall and bury him (hand sticks out), "GAME OVER", height, tap to climb again.
- Score: meters climbed. Save best.

## Phases (one session each)
1. **Gray box** — scaffold from dino repo; boxes for holds/climber/rocks; swipe+arrow movement between holds; scroll; "!" + falling rocks; crumble; game over + restart. Done = playable on phone + desktop.
2. **Tune** — spacing, gaps, fall speed, crumble speed, difficulty ramp. Constants at top of game.js.
3. **Hands + reach** — two-hand rule, off-grid holds, slow long reaches.
4. **Sprites** — text-grid sprites (like dino `tools/`), 2 frames each: hang, reach, fall; start poses, "hi", chalk puffs, burial pile.
5. **Polish + share** — screen shake, sound, best score, og image, favicon, deploy.
