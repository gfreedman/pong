/**
 * @file helpers.ts
 * @description Shared factory functions for Neon Pong unit tests.
 *
 * Every test starts from a fully-populated object that mirrors the live game's
 * initial state.  Overrides allow each test to tweak only the fields it cares
 * about — keeping test bodies short and intent clear.
 *
 * Import pattern:
 *   import { makeBall, makeP1, makeP2, makeShake } from './helpers.js';
 */

import { Ball, Paddle, ScreenShake } from '../src/types.js';
import
{
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BALL_RADIUS, BALL_BASE_SPEED,
  PADDLE_WIDTH, PADDLE_HEIGHT, PADDLE_MARGIN,
} from '../src/constants.js';

/* ═══════════════════════════════════════════════════════════════════════════
   BALL FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function makeBall
 * @description Returns a fully-populated Ball at canvas centre with sane
 *              defaults.  Pass an override object to change specific fields.
 *
 * @param overrides  Partial Ball fields to set on top of the defaults.
 * @returns {Ball}   A new Ball object ready for use in a test.
 */
export function makeBall(overrides: Partial<Ball> = {}): Ball
{
  return {
    x:            CANVAS_WIDTH  / 2,
    y:            CANVAS_HEIGHT / 2,
    vx:           300,
    vy:           0,
    spin:         0,
    radius:       BALL_RADIUS,
    speed:        BALL_BASE_SPEED,
    hitstopTimer: 0,
    squashTimer:  0,
    stretchTimer: 0,
    hitFlashTimer: 0,
    sadTimer:     0,
    spinAngle:    0,
    stickyHoldMs: 0,
    stickyOwner:  null,
    stickyVx:     0,
    stickyVy:     0,
    trail:        [],
    trailTimer:   0,
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PADDLE FACTORIES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function makeP1
 * @description Returns a fully-populated left-side (human, id=1) Paddle at
 *              its canonical screen position with all animation state zeroed.
 *
 * @param overrides  Partial Paddle fields to apply on top of the defaults.
 * @returns {Paddle}
 */
export function makeP1(overrides: Partial<Paddle> = {}): Paddle
{
  const x = PADDLE_MARGIN;
  const y = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2;

  return {
    x,
    y,
    baseX:          x,
    width:          PADDLE_WIDTH,
    height:         PADDLE_HEIGHT,
    vy:             0,
    prevY:          y,
    recoilOffset:   0,
    recoilVelocity: 0,
    breathPhase:    0,
    chromaticTimer: 0,
    colorFlashTimer: 0,
    emotionOffset:  0,
    emotionVelocity: 0,
    id:             1,
    ...overrides,
  };
}

/**
 * @function makeP2
 * @description Returns a fully-populated right-side (AI, id=2) Paddle at its
 *              canonical screen position with all animation state zeroed.
 *
 * @param overrides  Partial Paddle fields to apply on top of the defaults.
 * @returns {Paddle}
 */
export function makeP2(overrides: Partial<Paddle> = {}): Paddle
{
  const x = CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH;
  const y = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2;

  return {
    x,
    y,
    baseX:          x,
    width:          PADDLE_WIDTH,
    height:         PADDLE_HEIGHT,
    vy:             0,
    prevY:          y,
    recoilOffset:   0,
    recoilVelocity: 0,
    breathPhase:    0,
    chromaticTimer: 0,
    colorFlashTimer: 0,
    emotionOffset:  0,
    emotionVelocity: 0,
    id:             2,
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN SHAKE FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function makeShake
 * @description Returns a ScreenShake with the specified intensity, duration,
 *              and elapsed time.  Defaults to all-zero (no shake).
 *
 * @param intensity  Peak displacement in pixels.
 * @param duration   Total shake duration in ms.
 * @param elapsed    How many ms have already passed.
 * @returns {ScreenShake}
 */
export function makeShake(
  intensity = 0,
  duration  = 0,
  elapsed   = 0,
): ScreenShake
{
  return { intensity, duration, elapsed };
}
