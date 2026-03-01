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
     Handled entirely by CSS: style.css sets
       width: min(100vw, calc(100vh * 16 / 9)); aspect-ratio: 16 / 9;
     This is a CSS-native contain calculation — no JS inline styles needed,
     so there is no JS/CSS fight on any viewport shape.                  */

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
