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

  /* ── Step 2: Responsive scaling ───────────────────────────────────────
     We want the game to fill as much of the screen as possible without
     distortion.  The trick: try filling full width, check if the height
     fits, and if not constrain by height instead.                       */

  /**
   * @function resize
   * @description Recalculates the CSS display dimensions of the canvas so it
   *              fills the viewport at a 16:9 ratio. Called on startup and on
   *              every window resize event.
   *
   *              This only affects how large the canvas *looks* on screen.
   *              The drawing buffer stays at 960 × 540 logical pixels regardless.
   */
  function resize(): void
  {
    const vw    = window.innerWidth;
    const vh    = window.innerHeight;
    const ratio = 960 / 540;   // 16 ÷ 9 ≈ 1.778

    /* Start by filling the full viewport width */
    let w = vw;
    let h = vw / ratio;

    /* If that height overflows the viewport, constrain by height instead */
    if (h > vh)
    {
      h = vh;
      w = vh * ratio;
    }

    canvas!.style.width  = `${w}px`;
    canvas!.style.height = `${h}px`;
  }

  /* Apply sizing immediately, then re-apply whenever the window changes */
  resize();
  window.addEventListener('resize', resize);

  /* ── Step 3: Create and start the game ───────────────────────────────
     Game owns the entire state machine, game loop, and all subsystems.  */
  const game = new Game(canvas);
  game.start();

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
