// npm entry: mount(el, options) and the <free-solo> custom element.
import Phaser from './phaser.js';
import { createGame } from '../game.js';

/** Runs Free Solo inside `el`, at el's size. Returns { destroy, pause, resume }. */
export function mount(el, options) {
  if (!el || typeof el.appendChild !== 'function') throw new TypeError('free-solo: mount(el) needs a DOM element');
  return createGame(Phaser, el, options);
}

// <free-solo keys="focus|window" storage-key="..."></free-solo>
// Defaults to display:block, 100% wide and 480px tall; size it with CSS.
export class FreeSoloElement extends HTMLElement {
  connectedCallback() {
    if (this._game) return;  // moved within the page: keep playing
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>:host{display:block;height:480px}:host([hidden]){display:none}' +
        '.board{width:100%;height:100%}</style><div class="board" part="board"></div>';
    }
    this._game = mount(this.shadowRoot.querySelector('.board'), {
      keys: this.getAttribute('keys') || undefined,
      storageKey: this.getAttribute('storage-key') || undefined
    });
  }

  disconnectedCallback() {
    // Wait a tick: a remove + re-insert (a move) shouldn't restart the game
    queueMicrotask(() => {
      if (this.isConnected || !this._game) return;
      this._game.destroy();
      this._game = null;
    });
  }
}

if (!customElements.get('free-solo')) customElements.define('free-solo', FreeSoloElement);
