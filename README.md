# Free Solo

A tiny endless climbing game: no rope, two hands, falling rocks. Arrow keys or swipes move a hand. A rock hit means game over. Your best height is saved in `localStorage`.

You can drop it into any page as a custom element or mount it into an element you already have. It fills whatever box you give it and follows that box's size.

## Install

```bash
npm install free-solo
```

For a local, unpublished copy: run `npm pack` in this repo, then `npm install ./free-solo-0.1.0.tgz` in your site.

## Use

### One line: the custom element

```html
<script type="module">import 'free-solo';</script>

<free-solo style="width: 360px; height: 520px"></free-solo>
```

With no bundler, point the script at the file: `<script type="module" src="https://unpkg.com/free-solo"></script>` (or at `node_modules/free-solo/dist/free-solo.js`).

The element is `display: block`, 100% wide and 480px tall by default. Size it with CSS. Removing it from the page stops the game and cleans up. Moving it keeps the game running.

Attributes:

| attribute | values | default |
|---|---|---|
| `keys` | `focus`: arrow keys work only after the game is clicked or tapped (the page keeps its arrow-key scrolling). `window`: arrow keys work page-wide. | `focus` |
| `storage-key` | the `localStorage` key for the best height | `freesolo-best-m` |

### From JavaScript: `mount(el)`

```js
import { mount } from 'free-solo';

const game = mount(document.getElementById('game'), { keys: 'focus' });
// later
game.destroy();
```

- `mount(el, options?)` runs a game inside `el`, sized to `el`, and returns `{ destroy }`. The options are `keys` and `storageKey`, the same as the attributes above. If `el` has no height, it is given 480px.
- `destroy()` stops the game, removes its canvas and event listeners, and puts back `el`'s original `style` and `tabindex`.
- You can run several games on one page.
- TypeScript types are included.

The package runs in the browser only, so with SSR, import it on the client.

## How it's packaged

- **Phaser is bundled.** `dist/free-solo.js` is a single ES module of about 1.2 MB that contains Phaser 3.80.1 (MIT License, © Richard Davey, Photon Storm Ltd.). That makes the one-line `<script type="module">` work with no bundler, and the game always runs on the Phaser version it was tuned for. The cost is size: a site that already uses Phaser loads it twice.
- **No globals.** Phaser normally sets `window.Phaser`. The bundle puts back whatever was there before. The only thing registered on the page is the `free-solo` element name.
- Input uses the game's own listeners on its container, so the page around it scrolls and works normally.

## Develop

```bash
npm install
npm run build      # dist/free-solo.js
npm run watch      # rebuild on change
python3 tools/serve.py   # http://127.0.0.1:8767/ (full-page game) and /demo.html (embeds)
```

- `game.js` holds the game (`createGame(Phaser, container, options)`), and `sprites.js` holds the pixel sprites.
- `index.html` loads those directly with the vendored `vendor/phaser.min.js`, so the full-page game needs no build step.
- `src/index.js` is the npm entry. It provides `mount` and `<free-solo>`.
- `npm pack` builds first (`prepack`) and ships only `dist/`, `types/`, the README and `package.json`.
