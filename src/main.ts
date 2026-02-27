// Entry point — bootstrap canvas, instantiate Game, start loop

import { Game } from './game.js';

function main(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('Could not find #game-canvas element');
    return;
  }

  // Responsive canvas scaling: fit to viewport maintaining 16:9
  function resize(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ratio = 960 / 540;

    let w = vw;
    let h = vw / ratio;

    if (h > vh) {
      h = vh;
      w = vh * ratio;
    }

    canvas!.style.width  = `${w}px`;
    canvas!.style.height = `${h}px`;
  }

  resize();
  window.addEventListener('resize', resize);

  const game = new Game(canvas);
  game.start();

  // Expose for tests
  (window as Window & { __game?: Game }).__game = game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
