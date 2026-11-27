# Free Solo

An endless climbing game: move one hand at a time up the wall and dodge falling rocks.

![Free Solo gameplay](./assets/gameplay.png)

## Embed

```html
<script type="module" src="https://unpkg.com/free-solo"></script>
<free-solo style="width: 360px; height: 520px"></free-solo>
```

Or from JavaScript:

```js
import { mount } from 'free-solo';

const game = mount(document.getElementById('game'), { keys: 'focus' });
game.destroy();
```

| Option | Attribute | Default | Description |
|---|---|---|---|
| `keys` | `keys` | `focus` | `focus`: arrow keys work after the game is clicked. `window`: arrow keys work page-wide. |
| `storageKey` | `storage-key` | `freesolo-best-m` | `localStorage` key for the best height. |

## Develop

```bash
npm install
npm run build
npm run dev
```

Open http://127.0.0.1:8767 for the game and `/demo.html` for the embeds.
