export interface MountOptions {
  /** 'focus' (default): arrow keys only while the game has focus. 'window': arrow keys page-wide. */
  keys?: 'focus' | 'window';
  /** localStorage key for the best height. Default 'freesolo-best-m'. */
  storageKey?: string;
  /** false: draw the first frame, then stay paused until resume(). Default true. */
  active?: boolean;
}

export interface FreeSoloGame {
  /** Stops the game, removes its canvas and listeners, and restores the container. */
  destroy(): void;
  /** Freezes the climb where it is, stops the game loop, and ignores keys and taps. */
  pause(): void;
  /** Re-enables input and carries on from where pause() left off. */
  resume(): void;
}

/** Runs Free Solo inside `el`, sized to el (it follows el's size). */
export function mount(el: HTMLElement, options?: MountOptions): FreeSoloGame;

/** The <free-solo> element, registered when the package is imported. */
export class FreeSoloElement extends HTMLElement {}

declare global {
  interface HTMLElementTagNameMap {
    'free-solo': FreeSoloElement;
  }
}
