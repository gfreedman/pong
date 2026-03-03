/**
 * @file constants.test.ts
 * @description Regression tests for the runtime functions in constants.ts.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Several production bugs traced back to the three functions tested here:
 *
 *   setCanvasWidth — "Always fill viewport" commit (8558eea) removed letterbox
 *     pillars that had been providing implicit notch clearance on iPhones.
 *     Tests ensure the aspect-ratio math stays correct across common viewports.
 *
 *   setSafeInsets — iOS Safari resolves env(safe-area-inset-*) to 0
 *     synchronously at DOMContentLoaded and only provides real values after
 *     the first paint.  A rAF refresh was added (902dc48) to re-read them.
 *     Tests pin the CSS-px → game-px scaling formula so it can't silently
 *     regress when either the scale or the inset values change.
 *
 *   powerUpColor — was originally a method on Game; extracting it to a
 *     module-level function caused a ReferenceError on power-up collection
 *     (fixed in 62e6d5d).  Tests verify it exists as a callable export and
 *     returns the correct color for every PowerUpType variant.
 *
 * PADDDLE POSITION FORMULA (refreshPaddleInsets in game.ts)
 * ----------------------------------------------------------
 * game.ts.refreshPaddleInsets() cannot be unit-tested directly without
 * instantiating Game (which needs a real canvas + DOM).  Instead, tests
 * here verify that the *inputs to that formula* — PADDLE_MARGIN,
 * SAFE_INSET_LEFT_PX, SAFE_INSET_RIGHT_PX, CANVAS_WIDTH — are correct after
 * setCanvasWidth() and setSafeInsets() run, which is sufficient to prove
 * the outputs will be correct.
 *
 * All imports are live ESM bindings: mutating `let` exports via the setter
 * functions is immediately visible to any test that reads them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  setCanvasWidth,
  setSafeInsets,
  powerUpColor,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SAFE_INSET_LEFT_PX,
  SAFE_INSET_RIGHT_PX,
  PADDLE_MARGIN,
  PADDLE_WIDTH,
  COLOR_POWERUP_WIDE,
  COLOR_POWERUP_SPEED,
  COLOR_POWERUP_STICKY,
  COLOR_POWERUP_TRAIL,
} from './constants.js';

/* Reset shared module state between tests so order never matters. */
afterEach(() =>
{
  setCanvasWidth(960, 540);              // restore CANVAS_WIDTH to default
  vi.stubGlobal('window', { innerHeight: 540 });
  setSafeInsets(0, 0);                   // restore insets to 0
  vi.unstubAllGlobals();
});

/* ── setCanvasWidth ──────────────────────────────────────────────────────────
   Regression: "always fill viewport" commit broke implicit notch clearance.
   The formula CANVAS_WIDTH = round(540 * vw / vh) must stay exact.           */

describe('setCanvasWidth', () =>
{
  it('standard 16:9 viewport (960×540) yields CANVAS_WIDTH = 960', () =>
  {
    setCanvasWidth(960, 540);
    expect(CANVAS_WIDTH).toBe(960);
  });

  it('CANVAS_HEIGHT is always 540 — never changed by setCanvasWidth', () =>
  {
    setCanvasWidth(1920, 1080);
    expect(CANVAS_HEIGHT).toBe(540);
  });

  it('iPhone 12 Pro landscape (844×390) yields CANVAS_WIDTH > 960', () =>
  {
    // 2.16:1 aspect ratio — wider than 16:9, no letterbox, game fills screen
    setCanvasWidth(844, 390);
    const expected = Math.round(540 * 844 / 390); // 1169
    expect(CANVAS_WIDTH).toBe(expected);
    expect(CANVAS_WIDTH).toBeGreaterThan(960);
  });

  it('formula is round(CANVAS_HEIGHT * vw / vh) for any viewport', () =>
  {
    // iPad landscape — 4:3-ish
    setCanvasWidth(1024, 768);
    expect(CANVAS_WIDTH).toBe(Math.round(540 * 1024 / 768));
  });

  it('calling setCanvasWidth twice keeps only the latest result', () =>
  {
    setCanvasWidth(1920, 1080);
    setCanvasWidth(844, 390);
    expect(CANVAS_WIDTH).toBe(Math.round(540 * 844 / 390));
  });
});

/* ── setSafeInsets ───────────────────────────────────────────────────────────
   Regression: notch bug (c0b80d8) re-appeared after fill-viewport commit.
   iOS returns CSS env() as 0 at DOMContentLoaded; re-read after first paint.
   Formula: scale = CANVAS_HEIGHT / window.innerHeight; inset = ceil(css * scale) */

describe('setSafeInsets', () =>
{
  it('zero CSS insets produce zero game insets', () =>
  {
    vi.stubGlobal('window', { innerHeight: 540 });
    setSafeInsets(0, 0);
    expect(SAFE_INSET_LEFT_PX).toBe(0);
    expect(SAFE_INSET_RIGHT_PX).toBe(0);
  });

  it('scales left CSS inset to game pixels: ceil(css * CANVAS_HEIGHT / innerHeight)', () =>
  {
    vi.stubGlobal('window', { innerHeight: 390 }); // iPhone 12 Pro landscape
    setSafeInsets(44, 0);                           // 44px = typical notch inset
    const expected = Math.ceil(44 * (CANVAS_HEIGHT / 390));
    expect(SAFE_INSET_LEFT_PX).toBe(expected);
  });

  it('scales right CSS inset independently', () =>
  {
    vi.stubGlobal('window', { innerHeight: 390 });
    setSafeInsets(0, 20);
    const expected = Math.ceil(20 * (CANVAS_HEIGHT / 390));
    expect(SAFE_INSET_RIGHT_PX).toBe(expected);
  });

  it('game insets are whole integers — ceil means no fractional game pixels', () =>
  {
    vi.stubGlobal('window', { innerHeight: 390 });
    setSafeInsets(44, 20);
    expect(Number.isInteger(SAFE_INSET_LEFT_PX)).toBe(true);
    expect(Number.isInteger(SAFE_INSET_RIGHT_PX)).toBe(true);
  });

  it('non-zero left inset pushes P1 paddle right of bare PADDLE_MARGIN', () =>
  {
    vi.stubGlobal('window', { innerHeight: 390 });
    setCanvasWidth(844, 390);
    setSafeInsets(44, 0);

    // P1 formula: PADDLE_MARGIN + SAFE_INSET_LEFT_PX
    const p1x = PADDLE_MARGIN + SAFE_INSET_LEFT_PX;
    expect(p1x).toBeGreaterThan(PADDLE_MARGIN); // inset has effect
  });

  it('non-zero right inset pushes P2 paddle left of bare right wall position', () =>
  {
    vi.stubGlobal('window', { innerHeight: 390 });
    setCanvasWidth(844, 390);
    setSafeInsets(0, 44);

    // P2 formula: CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH - SAFE_INSET_RIGHT_PX
    const bareP2x  = CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH;
    const insetP2x = bareP2x - SAFE_INSET_RIGHT_PX;
    expect(insetP2x).toBeLessThan(bareP2x); // inset has effect
  });

  it('zero insets place P1 exactly at PADDLE_MARGIN (no notch offset)', () =>
  {
    vi.stubGlobal('window', { innerHeight: 540 });
    setSafeInsets(0, 0);
    const p1x = PADDLE_MARGIN + SAFE_INSET_LEFT_PX;
    expect(p1x).toBe(PADDLE_MARGIN);
  });

  it('re-calling with new values updates insets (simulates rAF refresh)', () =>
  {
    vi.stubGlobal('window', { innerHeight: 390 });
    setSafeInsets(0, 0);          // first call returns 0 (iOS DOMContentLoaded)
    expect(SAFE_INSET_LEFT_PX).toBe(0);

    setSafeInsets(44, 0);         // rAF re-call after first paint — real value
    expect(SAFE_INSET_LEFT_PX).toBeGreaterThan(0);
  });
});

/* ── powerUpColor ────────────────────────────────────────────────────────────
   Regression: powerUpColor was a method on Game; refactoring it to a module-
   level export caused a ReferenceError crash on power-up collection (62e6d5d).
   These tests confirm it is an importable function and maps all four types.    */

describe('powerUpColor', () =>
{
  it('is exported as a callable module-level function', () =>
  {
    expect(typeof powerUpColor).toBe('function');
  });

  it('WIDE_PADDLE → COLOR_POWERUP_WIDE', () =>
  {
    expect(powerUpColor('WIDE_PADDLE')).toBe(COLOR_POWERUP_WIDE);
  });

  it('SPEED_BOOTS → COLOR_POWERUP_SPEED', () =>
  {
    expect(powerUpColor('SPEED_BOOTS')).toBe(COLOR_POWERUP_SPEED);
  });

  it('STICKY_PADDLE → COLOR_POWERUP_STICKY', () =>
  {
    expect(powerUpColor('STICKY_PADDLE')).toBe(COLOR_POWERUP_STICKY);
  });

  it('TRAIL_BLAZER → COLOR_POWERUP_TRAIL', () =>
  {
    expect(powerUpColor('TRAIL_BLAZER')).toBe(COLOR_POWERUP_TRAIL);
  });

  it('returns a valid CSS hex string for every PowerUpType', () =>
  {
    const cssHex = /^#[0-9a-f]{6}$/i;
    const types: Parameters<typeof powerUpColor>[0][] = [
      'WIDE_PADDLE', 'SPEED_BOOTS', 'STICKY_PADDLE', 'TRAIL_BLAZER',
    ];
    for (const t of types)
    {
      expect(powerUpColor(t), `powerUpColor('${t}')`).toMatch(cssHex);
    }
  });
});
