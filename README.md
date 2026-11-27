# Free Solo

An endless climbing game: move one hand at a time up the wall and dodge falling rocks.

<img src="./assets/gameplay.png" alt="Free Solo gameplay" width="360">

## Embed

```html
<script type="module" src="https://unpkg.com/free-solo"></script>
<free-solo style="width: 360px; height: 520px"></free-solo>
```

Or install it and mount it from JavaScript:

```bash
npm install free-solo
```

```js
import { mount } from 'free-solo';

const game = mount(document.getElementById('game'));
game.destroy(); // removes the canvas and listeners
```

Options (as attributes on the element, or as options to `mount`):

| Attribute | Option | Default | |
|---|---|---|---|
| `keys` | `keys` | `focus` | `focus`: arrow keys work after the game is clicked. `window`: arrow keys work page-wide. |
| `storage-key` | `storageKey` | `freesolo-best-m` | `localStorage` key for the best height. |

Phaser 3.80.1 is bundled. TypeScript types are included. Browser only: with SSR, import it on the client.

## Develop

```bash
npm install
npm run build   # dist/free-solo.js
npm run dev     # http://127.0.0.1:8767 (game) and /demo.html (embeds)
```
