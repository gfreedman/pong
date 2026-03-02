/**
 * @file main.ts
 * @description Entry point for Neon Pong.
 *
 * Responsibilities:
 *   1. Locate the <canvas> element declared in index.html.
 *   2. Scale the canvas display size to fill the viewport while preserving
 *      the 16:9 aspect ratio (960 × 540 logical pixels).
 *   3. Instantiate the Game and start the requestAnimationFrame loop.
 *
 * Think of this like the `main()` function in C — it is where execution begins.
 */

import { Game } from './game.js';
import { setCanvasWidth, setSafeInsets } from './constants.js';

/**
 * @function main
 * @description Bootstraps the game. Runs once when the DOM is ready.
 */
function main(): void
{
  /* ── Step 1: Find the canvas ──────────────────────────────────────────
     The canvas element lives in index.html.  If it is missing we bail
     early with an error rather than crashing silently later.            */
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas)
  {
    console.error('Could not find #game-canvas element');
    return;
  }

  /* ── Step 2: Lock canvas width to the actual viewport aspect ratio ───
     CANVAS_HEIGHT is fixed at 540.  CANVAS_WIDTH is computed here so the
     game coordinate space is exactly viewport-shaped — no bars, no clip,
     on any display.  Must run before new Game() so all subsystems see
     the correct width from the moment they initialise.                  */
  setCanvasWidth(window.innerWidth, window.innerHeight);

  /* Read safe-area insets from the CSS custom properties set in style.css.
     env() values are only accessible via computed style, not directly in JS. */
  const cs  = getComputedStyle(document.documentElement);
  const sal = parseFloat(cs.getPropertyValue('--sal')) || 0;
  const sar = parseFloat(cs.getPropertyValue('--sar')) || 0;
  setSafeInsets(sal, sar);

  /* ── Step 3: Create and start the game ───────────────────────────────
     Game owns the entire state machine, game loop, and all subsystems.  */
  const game = new Game(canvas);
  game.start();

  /* ── Mobile: orientation lock + graceful orientation handling ─────────
     Request landscape lock so the OS rotates the game automatically.
     iOS Safari ignores lock() — the CSS rotate-prompt handles that case.
     On orientation change: pause the game and resize the canvas once the
     browser has finished its animation (~300 ms).  No page reload needed. */
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || ('ontouchstart' in window)
    || (navigator.maxTouchPoints > 1);

  if (isMobile)
  {
    (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
      ?.lock?.('landscape')
      ?.catch(() => { /* iOS: CSS rotate-prompt is the fallback */ });

    window.addEventListener('orientationchange', () =>
    {
      setTimeout(() =>
      {
        /* Only recalculate logical canvas width when back in landscape —
           portrait dimensions would corrupt game-coordinate math.       */
        if (window.innerWidth > window.innerHeight)
        {
          setCanvasWidth(window.innerWidth, window.innerHeight);
        }
        game.handleOrientationChange();
      }, 300);
    });
  }

  /* Expose instance on window for browser-console debugging and tests */
  (window as Window & { __game?: Game }).__game = game;
}

/* ── Wait for DOM before running ──────────────────────────────────────────
   If the HTML is still being parsed when this script runs, defer main()
   until DOMContentLoaded.  If the DOM is already ready (e.g. script is
   deferred or loaded after parse), call main() immediately.             */
if (document.readyState === 'loading')
{
  document.addEventListener('DOMContentLoaded', main);
}
else
{
  main();
}
