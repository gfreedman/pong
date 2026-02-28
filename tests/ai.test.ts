/**
 * @file ai.test.ts
 * @description Unit tests for the AIController class in ai.ts.
 *
 * SCOPE
 * -----
 * AIController is testable because its core algorithm — predict-then-track —
 * only reads Ball/Paddle structs and writes to Paddle fields.  It has no DOM
 * dependency and produces deterministic structural outcomes (even when
 * individual values are random, the invariants hold).
 *
 * STRATEGY
 * --------
 * Private fields (config, targetY, decisionTimer) are accessed via `as any`
 * casts, which is standard practice for white-box unit testing.
 *
 * ORGANISATION
 * ------------
 *   1. configure  — difficulty switching and state reset
 *   2. reset      — explicit reset call
 *   3. update — general   — movement, clamping, prevY recording
 *   4. update — EASY      — no prediction, long delay, center drift
 *   5. update — MEDIUM    — ballistic prediction
 *   6. update — HARD      — near-max speed, short delay
 */

import { describe, test, expect } from 'vitest';
import { AIController } from '../src/ai.js';
import
{
  CANVAS_HEIGHT,
  PADDLE_BASE_SPEED,
  BALL_RADIUS,
  AI_EASY_SPEED_FACTOR,
  AI_EASY_REACTION_DELAY_MIN,
  AI_EASY_REACTION_DELAY_MAX,
  AI_SPEED_FACTOR,
  AI_HARD_SPEED_FACTOR,
  AI_HARD_REACTION_DELAY_MIN,
  AI_HARD_REACTION_DELAY_MAX,
} from '../src/constants.js';
import { makeP2, makeBall } from './helpers.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. configure
   ═══════════════════════════════════════════════════════════════════════════ */

describe('AIController.configure', () =>
{
  /** EASY speedFactor must be well below 0.6 (slow AI). */
  test('configure(EASY) sets speedFactor < 0.6', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');
    expect((ai as any).config.speedFactor).toBeLessThan(0.6);
    expect((ai as any).config.speedFactor).toBe(AI_EASY_SPEED_FACTOR);
  });

  /** MEDIUM speedFactor matches the documented baseline value. */
  test('configure(MEDIUM) sets speedFactor ≈ AI_SPEED_FACTOR', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    expect((ai as any).config.speedFactor).toBeCloseTo(AI_SPEED_FACTOR, 5);
  });

  /** HARD speedFactor is near the maximum (> 0.95). */
  test('configure(HARD) sets speedFactor > 0.95', () =>
  {
    const ai = new AIController();
    ai.configure('HARD');
    expect((ai as any).config.speedFactor).toBeGreaterThan(0.95);
    expect((ai as any).config.speedFactor).toBe(AI_HARD_SPEED_FACTOR);
  });

  /** configure() resets targetY to canvas centre so old match state is gone. */
  test('configure resets targetY to canvas centre', () =>
  {
    const ai = new AIController();
    (ai as any).targetY = 999;
    ai.configure('MEDIUM');
    expect((ai as any).targetY).toBe(CANVAS_HEIGHT / 2);
  });

  /** configure() resets decisionTimer to 0 forcing an immediate recalculation. */
  test('configure resets decisionTimer to 0', () =>
  {
    const ai = new AIController();
    (ai as any).decisionTimer = 500;
    ai.configure('MEDIUM');
    expect((ai as any).decisionTimer).toBe(0);
  });

  /** configure() sets predictionMode = 'none' for EASY. */
  test('configure(EASY) uses predictionMode = none', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');
    expect((ai as any).config.predictionMode).toBe('none');
  });

  /** configure() sets predictionMode = 'spin' for HARD. */
  test('configure(HARD) uses predictionMode = spin', () =>
  {
    const ai = new AIController();
    ai.configure('HARD');
    expect((ai as any).config.predictionMode).toBe('spin');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. reset
   ═══════════════════════════════════════════════════════════════════════════ */

describe('AIController.reset', () =>
{
  /** reset() returns targetY to canvas centre. */
  test('reset sets targetY to canvas centre', () =>
  {
    const ai = new AIController();
    (ai as any).targetY = 100;
    ai.reset();
    expect((ai as any).targetY).toBe(CANVAS_HEIGHT / 2);
  });

  /** reset() zeroes the decision timer, forcing an immediate reaction on next update. */
  test('reset sets decisionTimer to 0', () =>
  {
    const ai = new AIController();
    (ai as any).decisionTimer = 300;
    ai.reset();
    expect((ai as any).decisionTimer).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. update — general
   ═══════════════════════════════════════════════════════════════════════════ */

describe('AIController.update — general', () =>
{
  /** prevY is recorded as the pre-move Y so physics can compute spin impartment. */
  test('records prevY before moving paddle', () =>
  {
    const ai     = new AIController();
    ai.configure('HARD');
    const paddle = makeP2({ y: 150 });
    const ball   = makeBall({ x: 800, vx: 400, y: 300 });
    ai.update(paddle, ball, 16);
    /* prevY must equal the Y value paddle had at the START of this frame. */
    expect(paddle.prevY).toBe(150);
  });

  /** Paddle y never exits the valid [0, CANVAS_HEIGHT - height] range. */
  test('clamps paddle y to valid screen bounds', () =>
  {
    const ai     = new AIController();
    ai.configure('HARD');
    const paddle = makeP2({ y: 0 });
    /* Force the AI to target something far off screen. */
    (ai as any).targetY = -9999;
    const ball   = makeBall({ x: 800, vx: 400 });
    ai.update(paddle, ball, 200);
    expect(paddle.y).toBeGreaterThanOrEqual(0);
    expect(paddle.y).toBeLessThanOrEqual(CANVAS_HEIGHT - paddle.height);
  });

  /** Over many frames the HARD AI paddle moves toward the ball's Y position. */
  test('moves paddle toward ball Y over multiple frames (HARD)', () =>
  {
    const ai     = new AIController();
    ai.configure('HARD');
    /* Paddle starts at top; ball is at bottom — AI must move down. */
    const paddle = makeP2({ y: 0 });
    const ball   = makeBall({ x: 800, vx: 400, y: CANVAS_HEIGHT - 20 });
    for (let i = 0; i < 60; i++) ai.update(paddle, ball, 16);
    /* After ~1 second of 60fps, paddle must have moved significantly downward. */
    expect(paddle.y).toBeGreaterThan(100);
  });

  /** update() does not produce NaN in any paddle field. */
  test('paddle fields remain finite after update', () =>
  {
    const ai     = new AIController();
    ai.configure('MEDIUM');
    const paddle = makeP2();
    const ball   = makeBall({ x: 800, vx: 300, y: 200 });
    for (let i = 0; i < 10; i++) ai.update(paddle, ball, 16);
    expect(Number.isFinite(paddle.y)).toBe(true);
    expect(Number.isFinite(paddle.vy)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. update — EASY mode
   ═══════════════════════════════════════════════════════════════════════════ */

describe('AIController.update — EASY', () =>
{
  /**
   * After configure() the decisionTimer is 0, so the first update() call
   * immediately triggers a recalculation and sets a new reaction delay.
   * That delay must fall within the EASY range [240, 380].
   */
  test('AI reaction delay falls in [EASY_MIN, EASY_MAX] after first recalculation', () =>
  {
    const ai     = new AIController();
    ai.configure('EASY');
    const paddle = makeP2();
    const ball   = makeBall({ x: 800, vx: 400 });
    ai.update(paddle, ball, 1);
    const timer  = (ai as any).decisionTimer as number;
    expect(timer).toBeGreaterThanOrEqual(AI_EASY_REACTION_DELAY_MIN);
    expect(timer).toBeLessThanOrEqual(AI_EASY_REACTION_DELAY_MAX);
  });

  /**
   * When the ball moves away (vx < 0) the EASY AI uses the canvas centre as
   * its predicted Y instead of tracking the ball directly.
   * targetY should therefore be in the middle third of the screen.
   */
  test('when ball moves away (vx < 0), EASY AI targets near canvas centre', () =>
  {
    const ai     = new AIController();
    ai.configure('EASY');
    const paddle = makeP2();
    /* Ball near the bottom moving leftward — EASY AI should not chase it. */
    const ball   = makeBall({ x: 800, vx: -400, y: CANVAS_HEIGHT - 10 });
    ai.update(paddle, ball, 1);
    /* targetY = clamp(CANVAS_HEIGHT/2 - h/2 + error, 0, H-h).
       Even with max error (90px), targetY should stay in valid range. */
    const target = (ai as any).targetY as number;
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThanOrEqual(CANVAS_HEIGHT - paddle.height);
    /* The target should be in the middle half of the court, not near the ball. */
    expect(target).toBeGreaterThanOrEqual(CANVAS_HEIGHT * 0.1);
    expect(target).toBeLessThanOrEqual(CANVAS_HEIGHT * 0.9);
  });

  /** EASY speedFactor means the max speed is slower than MEDIUM and HARD. */
  test('EASY max paddle speed is less than MEDIUM max speed', () =>
  {
    const easyMax   = PADDLE_BASE_SPEED * AI_EASY_SPEED_FACTOR;
    const mediumMax = PADDLE_BASE_SPEED * AI_SPEED_FACTOR;
    expect(easyMax).toBeLessThan(mediumMax);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. update — MEDIUM mode
   ═══════════════════════════════════════════════════════════════════════════ */

describe('AIController.update — MEDIUM', () =>
{
  /** MEDIUM AI produces a valid (in-bounds) targetY for any ball trajectory. */
  test('MEDIUM AI produces a valid targetY for a bouncing trajectory', () =>
  {
    const ai     = new AIController();
    ai.configure('MEDIUM');
    /* Ball near the top wall, moving upward fast — will bounce. */
    const paddle = makeP2();
    const ball   = makeBall(
    {
      x:  200,
      y:  BALL_RADIUS + 5,
      vx: 500,
      vy: -300,
    });
    ai.update(paddle, ball, 1);
    const target = (ai as any).targetY as number;
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThanOrEqual(CANVAS_HEIGHT - paddle.height);
  });

  /** MEDIUM prediction mode is 'ballistic' (not 'none' or 'spin'). */
  test('MEDIUM AI uses ballistic prediction mode', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    expect((ai as any).config.predictionMode).toBe('ballistic');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. update — HARD mode
   ═══════════════════════════════════════════════════════════════════════════ */

describe('AIController.update — HARD', () =>
{
  /** HARD max speed is > 95 % of PADDLE_BASE_SPEED. */
  test('HARD AI max paddle speed is > 95% of PADDLE_BASE_SPEED', () =>
  {
    const ai      = new AIController();
    ai.configure('HARD');
    const maxSpeed = PADDLE_BASE_SPEED * (ai as any).config.speedFactor;
    expect(maxSpeed).toBeGreaterThan(PADDLE_BASE_SPEED * 0.95);
  });

  /** HARD reaction delays are short — [55, 95] ms. */
  test('HARD AI reaction delay falls in [HARD_MIN, HARD_MAX]', () =>
  {
    const ai     = new AIController();
    ai.configure('HARD');
    const paddle = makeP2();
    const ball   = makeBall({ x: 800, vx: 400 });
    ai.update(paddle, ball, 1);
    const timer  = (ai as any).decisionTimer as number;
    expect(timer).toBeGreaterThanOrEqual(AI_HARD_REACTION_DELAY_MIN);
    expect(timer).toBeLessThanOrEqual(AI_HARD_REACTION_DELAY_MAX);
  });

  /** Over many frames HARD AI converges on the ball position tightly. */
  test('HARD AI converges on ball Y significantly within 2 seconds', () =>
  {
    const ai     = new AIController();
    ai.configure('HARD');
    const paddle = makeP2({ y: 0 });
    const targetBallY = 400;
    const ball        = makeBall({ x: 800, vx: 400, y: targetBallY });
    /* 2 seconds at 60fps. */
    for (let i = 0; i < 120; i++) ai.update(paddle, ball, 16);
    /* Paddle centre should be within 80px of ball Y (= ½ paddle height margin). */
    const paddleCentre = paddle.y + paddle.height / 2;
    expect(Math.abs(paddleCentre - targetBallY)).toBeLessThan(80);
  });
});
