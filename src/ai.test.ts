/**
 * @file ai.test.ts
 * @description Unit tests for AIController (ai.ts).
 *
 * Private fields are accessed via `as any` casts — the ai.ts source explicitly
 * documents this pattern in its "TEST COMPATIBILITY" comment block.
 *
 * All tests start with form = 0 (neutral) so baseline config values are observed
 * without dynamic form modulation, matching the inline "tested: X ✓" annotations.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AIController } from './ai.js';
import {
  CANVAS_HEIGHT,
  PADDLE_BASE_SPEED,
  AI_EASY_SPEED_FACTOR,
  AI_SPEED_FACTOR,
  AI_HARD_SPEED_FACTOR,
  AI_EASY_REACTION_DELAY_MIN,
  AI_EASY_REACTION_DELAY_MAX,
  AI_REACTION_DELAY_MIN,
  AI_REACTION_DELAY_MAX,
  AI_HARD_REACTION_DELAY_MIN,
  AI_HARD_REACTION_DELAY_MAX,
  AI_FORM_HIT_BONUS,
  AI_FORM_MISS_PENALTY,
} from './constants.js';
import type { Ball, Paddle } from './types.js';

/* ── Factories ─────────────────────────────────────────────────────────────── */

function makeBall(overrides: Partial<Ball> = {}): Ball
{
  return {
    x: 480, y: 270,
    vx: 300, vy: 0,
    spin: 0, spinAngle: 0,
    radius: 12, speed: 300,
    hitstopTimer: 0, squashTimer: 0, stretchTimer: 0,
    hitFlashTimer: 0, sadTimer: 0,
    trail: [], trailTimer: 0,
    stickyHoldMs: 0, stickyOwner: null, stickyVx: 0, stickyVy: 0,
    ...overrides,
  };
}

function makeAIPaddle(overrides: Partial<Paddle> = {}): Paddle
{
  return {
    x: 918, y: 230, baseX: 918,
    width: 12, height: 80,
    vy: 0, prevY: 230,
    recoilOffset: 0, recoilVelocity: 0,
    breathPhase: 0,
    chromaticTimer: 0, colorFlashTimer: 0,
    emotionOffset: 0, emotionVelocity: 0,
    id: 2,
    ...overrides,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

/* ── configure — speed factors ─────────────────────────────────────────────── */

describe('AIController.configure — speedFactor', () =>
{
  it('EASY speedFactor is < 0.6', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');
    expect((ai as any).config.speedFactor).toBe(AI_EASY_SPEED_FACTOR);
    expect((ai as any).config.speedFactor).toBeLessThan(0.6);
  });

  it('MEDIUM speedFactor is ≈ 0.85', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    expect((ai as any).config.speedFactor).toBe(AI_SPEED_FACTOR);
    expect((ai as any).config.speedFactor).toBeCloseTo(0.85, 2);
  });

  it('HARD speedFactor is > 0.95', () =>
  {
    const ai = new AIController();
    ai.configure('HARD');
    expect((ai as any).config.speedFactor).toBe(AI_HARD_SPEED_FACTOR);
    expect((ai as any).config.speedFactor).toBeGreaterThan(0.95);
  });
});

/* ── configure — prediction mode ──────────────────────────────────────────── */

describe('AIController.configure — predictionMode', () =>
{
  it('EASY uses "none" — tracks current ball position only', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');
    expect((ai as any).config.predictionMode).toBe('none');
  });

  it('MEDIUM uses "ballistic" — simulates wall bounces', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    expect((ai as any).config.predictionMode).toBe('ballistic');
  });

  it('HARD uses "spin" — full spin-aware prediction', () =>
  {
    const ai = new AIController();
    ai.configure('HARD');
    expect((ai as any).config.predictionMode).toBe('spin');
  });
});

/* ── configure — reaction delay ranges ────────────────────────────────────── */

describe('AIController.configure — reaction delays', () =>
{
  it('EASY delay range is [AI_EASY_REACTION_DELAY_MIN, AI_EASY_REACTION_DELAY_MAX]', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');
    const cfg = (ai as any).config;
    expect(cfg.reactionDelayMin).toBe(AI_EASY_REACTION_DELAY_MIN);
    expect(cfg.reactionDelayMax).toBe(AI_EASY_REACTION_DELAY_MAX);
    // Sanity: min is meaningfully slower than HARD
    expect(cfg.reactionDelayMin).toBeGreaterThan(100);
  });

  it('HARD delay range is [AI_HARD_REACTION_DELAY_MIN, AI_HARD_REACTION_DELAY_MAX]', () =>
  {
    const ai = new AIController();
    ai.configure('HARD');
    const cfg = (ai as any).config;
    expect(cfg.reactionDelayMin).toBe(AI_HARD_REACTION_DELAY_MIN);
    expect(cfg.reactionDelayMax).toBe(AI_HARD_REACTION_DELAY_MAX);
    // Sanity: hard reacts faster than easy
    expect(cfg.reactionDelayMax).toBeLessThan(AI_EASY_REACTION_DELAY_MIN);
  });
});

/* ── configure — resets form ───────────────────────────────────────────────── */

describe('AIController.configure — resets form', () =>
{
  it('form is 0 immediately after configure', () =>
  {
    const ai = new AIController();
    // Dirty the form first via notifyGoal calls
    ai.configure('MEDIUM');
    ai.notifyGoal(2); // AI scored → form goes up
    ai.notifyGoal(2);
    expect((ai as any).form).toBeGreaterThan(0);

    // Re-configure should zero form
    ai.configure('MEDIUM');
    expect((ai as any).form).toBe(0);
  });
});

/* ── notifyGoal — form changes ─────────────────────────────────────────────── */

describe('AIController.notifyGoal — form changes', () =>
{
  it('human scoring (1) decreases AI form', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    const before = (ai as any).form; // 0
    ai.notifyGoal(1); // human scored
    expect((ai as any).form).toBeLessThan(before);
    expect((ai as any).form).toBeCloseTo(0 - AI_FORM_MISS_PENALTY, 5);
  });

  it('AI scoring (2) increases AI form', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    ai.notifyGoal(2); // AI scored
    expect((ai as any).form).toBeGreaterThan(0);
    expect((ai as any).form).toBeCloseTo(AI_FORM_HIT_BONUS, 5);
  });

  it('form is clamped to +1 no matter how many AI goals', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    for (let i = 0; i < 20; i++) ai.notifyGoal(2);
    expect((ai as any).form).toBeLessThanOrEqual(1);
  });

  it('form is clamped to -1 no matter how many human goals', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');
    for (let i = 0; i < 20; i++) ai.notifyGoal(1);
    expect((ai as any).form).toBeGreaterThanOrEqual(-1);
  });
});

/* ── update — paddle movement ──────────────────────────────────────────────── */

describe('AIController.update — paddle tracking', () =>
{
  beforeEach(() =>
  {
    // Pin Math.random so decisions are deterministic:
    //   - decisionTimer gets exact midpoint of delay range (no randomness)
    //   - aiming error = (0.5 - 0.5) * 2 * errorMax = 0 (perfect aim)
    //   - false read chance is 0 at neutral form regardless
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('EASY: paddle moves toward ball when ball is coming toward AI (vx > 0)', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');

    // Ball at top of screen, moving toward AI
    const ball = makeBall({ y: 0, vx: 300 });
    // Paddle starts at center (y=230); should move upward toward y=0
    const paddle = makeAIPaddle({ y: 230, vy: 0 });

    // Run several frames
    for (let i = 0; i < 10; i++) ai.update(paddle, ball, 16);

    // targetY should be near top (clamped to 0) and paddle should be moving up
    expect((ai as any).targetY).toBeLessThan(50);
    expect(paddle.y).toBeLessThan(230); // moved upward
  });

  it('EASY: paddle drifts toward center when ball moves away (vx < 0)', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');

    // Paddle starts at top; ball moving away from AI
    const ball = makeBall({ y: 100, vx: -300 });
    const paddle = makeAIPaddle({ y: 0, vy: 0 });

    // Force a decision on first frame (decisionTimer starts at 0)
    ai.update(paddle, ball, 16);

    // EASY predictionMode='none', vx < 0 → targetY = CANVAS_HEIGHT / 2 = 270
    // targetY clamped: max(0, min(460, 270 - 40 + 0)) = 230
    expect((ai as any).targetY).toBeCloseTo(CANVAS_HEIGHT / 2 - 40, 0);
  });

  it('MEDIUM/HARD: predictBallY returns center when ball moves away', () =>
  {
    const ai = new AIController();
    ai.configure('HARD');

    const ball = makeBall({ vx: -300 }); // moving away
    const paddle = makeAIPaddle({ y: 0, vy: 0 });

    ai.update(paddle, ball, 16);

    // predictBallY returns CANVAS_HEIGHT/2 when vx <= 0
    // targetY = clamp(0, 460, 270 - 40 + 0) = 230
    expect((ai as any).targetY).toBeCloseTo(CANVAS_HEIGHT / 2 - 40, 0);
  });

  it('paddle velocity is capped by difficulty speed factor', () =>
  {
    const ai = new AIController();
    ai.configure('EASY');

    const ball = makeBall({ y: 0, vx: 300 });
    const paddle = makeAIPaddle({ y: 230, vy: 0 });

    // Run enough frames to accelerate to full speed
    for (let i = 0; i < 30; i++) ai.update(paddle, ball, 16);

    const maxExpected = PADDLE_BASE_SPEED * AI_EASY_SPEED_FACTOR;
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(maxExpected + 1); // +1 for fp tolerance
  });

  it('decisionTimer is reset after firing so updates are batched, not every frame', () =>
  {
    const ai = new AIController();
    ai.configure('MEDIUM');

    const ball = makeBall();
    const paddle = makeAIPaddle();

    // First frame: decisionTimer=0 → fires decision, timer resets
    ai.update(paddle, ball, 16);
    const timerAfterFirstDecision = (ai as any).decisionTimer;

    expect(timerAfterFirstDecision).toBeGreaterThan(0); // reset to delay range
  });
});
