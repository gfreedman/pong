/**
 * @file physics.test.ts
 * @description Unit tests for physics.ts — the pure physics functions.
 *
 * All tests run in a Node environment with no DOM or canvas.
 * Structs are created with factory helpers; tests mutate and inspect them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resetBall,
  updateBall,
  triggerShake,
  getShakeOffset,
  updateScreenShake,
  spawnImpactRing,
  updateImpactRings,
  spawnWallMark,
  updateWallMarks,
  spawnGoalFlash,
  updateGoalFlashes,
  spawnGoalParticles,
  updateGoalParticles,
  triggerPaddleEmotion,
  updatePaddleAnimations,
} from './physics.js';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  BALL_RADIUS,
  BALL_BASE_SPEED,
  BALL_SPEED_INC,
  RING_DURATION_MS,
  WALL_MARK_FADE_MS,
  GOAL_FLASH_MS,
  GOAL_PARTICLE_MS,
  GOAL_PARTICLE_COUNT,
  EMOTION_SPRING_K,
  EMOTION_JUMP_PX,
  EMOTION_SAG_PX,
} from './constants.js';
import type { Ball, Paddle, ScreenShake } from './types.js';

/* ── Factories ─────────────────────────────────────────────────────────────── */

function makeBall(overrides: Partial<Ball> = {}): Ball
{
  return {
    x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2,
    vx: 300, vy: 0,
    spin: 0, spinAngle: 0,
    radius: BALL_RADIUS,
    speed: BALL_BASE_SPEED,
    hitstopTimer: 0, squashTimer: 0, stretchTimer: 0,
    hitFlashTimer: 0, sadTimer: 0,
    trail: [], trailTimer: 0,
    stickyHoldMs: 0, stickyOwner: null, stickyVx: 0, stickyVy: 0,
    ...overrides,
  };
}

function makeP1(overrides: Partial<Paddle> = {}): Paddle
{
  return {
    x: 30, y: 230, baseX: 30,
    width: 12, height: 80,
    vy: 0, prevY: 230,
    recoilOffset: 0, recoilVelocity: 0,
    breathPhase: 0,
    chromaticTimer: 0, colorFlashTimer: 0,
    emotionOffset: 0, emotionVelocity: 0,
    id: 1,
    ...overrides,
  };
}

function makeP2(overrides: Partial<Paddle> = {}): Paddle
{
  // x = CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH = 960 - 30 - 12 = 918
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

function makeShake(overrides: Partial<ScreenShake> = {}): ScreenShake
{
  return { intensity: 0, duration: 0, elapsed: 0, ...overrides };
}

afterEach(() => { vi.restoreAllMocks(); });

/* ── resetBall ─────────────────────────────────────────────────────────────── */

describe('resetBall', () =>
{
  it('centers the ball at canvas midpoint', () =>
  {
    const ball = makeBall({ x: 0, y: 0 });
    resetBall(ball, false);
    expect(ball.x).toBe(CANVAS_WIDTH / 2);
    expect(ball.y).toBe(CANVAS_HEIGHT / 2);
  });

  it('resets speed to BALL_BASE_SPEED', () =>
  {
    const ball = makeBall({ speed: 700 });
    resetBall(ball, false);
    expect(ball.speed).toBe(BALL_BASE_SPEED);
  });

  it('clears all timers and trail', () =>
  {
    const ball = makeBall({
      hitstopTimer: 50, squashTimer: 55, stretchTimer: 90,
      hitFlashTimer: 67, sadTimer: 300,
      spin: 5, spinAngle: 1.2,
      trail: [{ x: 10, y: 10 }], trailTimer: 8,
    });
    resetBall(ball, false);
    expect(ball.hitstopTimer).toBe(0);
    expect(ball.squashTimer).toBe(0);
    expect(ball.stretchTimer).toBe(0);
    expect(ball.hitFlashTimer).toBe(0);
    expect(ball.sadTimer).toBe(0);
    expect(ball.spin).toBe(0);
    expect(ball.spinAngle).toBe(0);
    expect(ball.trail).toHaveLength(0);
    expect(ball.trailTimer).toBe(0);
  });

  it('launches left when towardLeft=true (vx < 0)', () =>
  {
    const ball = makeBall();
    resetBall(ball, true);
    expect(ball.vx).toBeLessThan(0);
  });

  it('launches right when towardLeft=false (vx > 0)', () =>
  {
    const ball = makeBall();
    resetBall(ball, false);
    expect(ball.vx).toBeGreaterThan(0);
  });
});

/* ── updateBall — hitstop ──────────────────────────────────────────────────── */

describe('updateBall — hitstop', () =>
{
  it('freezes ball position while hitstopTimer > 0', () =>
  {
    const ball = makeBall({ x: 400, vx: 500, hitstopTimer: 50 });
    const p1 = makeP1();
    const p2 = makeP2();
    const startX = ball.x;

    updateBall(ball, p1, p2, 16, false);

    expect(ball.x).toBe(startX); // no movement
  });

  it('decrements hitstopTimer each frame', () =>
  {
    const ball = makeBall({ hitstopTimer: 50 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.hitstopTimer).toBeLessThan(50);
    expect(ball.hitstopTimer).toBeGreaterThanOrEqual(0);
  });
});

/* ── updateBall — wall bounces ─────────────────────────────────────────────── */

describe('updateBall — wall bounces', () =>
{
  it('bounces off the top wall: vy flips positive, hitWall=top', () =>
  {
    // Ball is nearly at top, moving up — integration will push it past boundary
    const ball = makeBall({ y: BALL_RADIUS, vy: -200 });
    const result = updateBall(ball, makeP1(), makeP2(), 16, false);

    expect(result.hitWall).toBe('top');
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.y).toBeGreaterThanOrEqual(BALL_RADIUS);
  });

  it('bounces off the bottom wall: vy flips negative, hitWall=bottom', () =>
  {
    const ball = makeBall({ y: CANVAS_HEIGHT - BALL_RADIUS, vy: 200 });
    const result = updateBall(ball, makeP1(), makeP2(), 16, false);

    expect(result.hitWall).toBe('bottom');
    expect(ball.vy).toBeLessThan(0);
    expect(ball.y).toBeLessThanOrEqual(CANVAS_HEIGHT - BALL_RADIUS);
  });

  it('toy mode: right wall reflects ball (hitWall=right)', () =>
  {
    const ball = makeBall({ x: CANVAS_WIDTH - BALL_RADIUS, vx: 300 });
    const result = updateBall(ball, makeP1(), makeP2(), 16, true);

    expect(result.hitWall).toBe('right');
    expect(ball.vx).toBeLessThan(0);
  });
});

/* ── updateBall — goals ────────────────────────────────────────────────────── */

describe('updateBall — goals', () =>
{
  it('P1 scores when ball exits right boundary (goal=1)', () =>
  {
    // Ball already past right edge
    const ball = makeBall({ x: CANVAS_WIDTH + BALL_RADIUS, vx: 100 });
    const result = updateBall(ball, makeP1(), makeP2(), 16, false);

    expect(result.goal).toBe(1);
  });

  it('P2 scores when ball exits left boundary (goal=2)', () =>
  {
    // Ball already past left edge
    const ball = makeBall({ x: -BALL_RADIUS, vx: -100 });
    const result = updateBall(ball, makeP1(), makeP2(), 16, false);

    expect(result.goal).toBe(2);
  });

  it('toy mode: left miss resets ball to center instead of scoring', () =>
  {
    const ball = makeBall({ x: -BALL_RADIUS, vx: -100 });
    const result = updateBall(ball, makeP1(), makeP2(), 16, true);

    expect(result.goal).toBeNull();
    expect(ball.x).toBeCloseTo(CANVAS_WIDTH / 2, 0);
  });
});

/* ── updateBall — paddle collision ─────────────────────────────────────────── */

describe('updateBall — paddle collision', () =>
{
  it('detects hit with P1 and sets hitPaddle=1', () =>
  {
    // Ball overlapping P1 (x=30..42, y=230..310)
    const ball = makeBall({ x: 36, y: 270, vx: -100 });
    const result = updateBall(ball, makeP1(), makeP2(), 1, false);

    expect(result.hitPaddle).toBe(1);
    expect(result.edgeFactor).toBeGreaterThanOrEqual(0);
    expect(result.edgeFactor).toBeLessThanOrEqual(1);
  });

  it('detects hit with P2 and sets hitPaddle=2', () =>
  {
    // Ball overlapping P2 (x=918..930, y=230..310)
    const ball = makeBall({ x: 924, y: 270, vx: 100 });
    const result = updateBall(ball, makeP1(), makeP2(), 1, false);

    expect(result.hitPaddle).toBe(2);
  });

  it('increases ball speed on paddle hit (capped at BALL_MAX_SPEED)', () =>
  {
    const initialSpeed = BALL_BASE_SPEED;
    const ball = makeBall({ x: 36, y: 270, vx: -100, speed: initialSpeed });
    updateBall(ball, makeP1(), makeP2(), 1, false);

    expect(ball.speed).toBeGreaterThan(initialSpeed);
    expect(ball.speed).toBeCloseTo(initialSpeed + BALL_SPEED_INC, 3);
  });

  it('pushes ball outside P1 paddle to prevent double-hit', () =>
  {
    const ball = makeBall({ x: 36, y: 270, vx: -100 });
    updateBall(ball, makeP1(), makeP2(), 1, false);

    // Ball left edge should be at or past paddle right edge (x=42)
    expect(ball.x - BALL_RADIUS).toBeGreaterThanOrEqual(42);
  });

  it('pushes ball outside P2 paddle to prevent double-hit', () =>
  {
    const ball = makeBall({ x: 924, y: 270, vx: 100 });
    updateBall(ball, makeP1(), makeP2(), 1, false);

    // Ball right edge should be at or before paddle left edge (x=918)
    expect(ball.x + BALL_RADIUS).toBeLessThanOrEqual(918);
  });

  it('center hit produces edgeFactor near 0', () =>
  {
    // Ball dead-center on P1 paddle (paddle spans y=230..310, center=270)
    const ball = makeBall({ x: 36, y: 270, vx: -100 });
    const result = updateBall(ball, makeP1(), makeP2(), 1, false);

    expect(result.edgeFactor).toBeLessThan(0.1);
  });

  it('edge hit produces edgeFactor near 1', () =>
  {
    // Ball at top edge of P1 paddle
    const ball = makeBall({ x: 36, y: 230, vx: -100 });
    const result = updateBall(ball, makeP1(), makeP2(), 1, false);

    expect(result.edgeFactor).toBeGreaterThan(0.8);
  });
});

/* ── triggerShake / getShakeOffset ─────────────────────────────────────────── */

describe('triggerShake', () =>
{
  it('starts a new shake from idle (elapsed >= duration → always applies)', () =>
  {
    const shake = makeShake(); // elapsed=0, duration=0, so elapsed >= duration
    triggerShake(shake, 5, 200);
    expect(shake.intensity).toBe(5);
    expect(shake.duration).toBe(200);
    expect(shake.elapsed).toBe(0);
  });

  it('stronger shake overrides a running weaker one', () =>
  {
    const shake = makeShake({ intensity: 3, duration: 200, elapsed: 50 });
    triggerShake(shake, 8, 300); // 8 >= 3 → applies
    expect(shake.intensity).toBe(8);
    expect(shake.elapsed).toBe(0);
  });

  it('weaker shake does NOT override a running stronger one', () =>
  {
    const shake = makeShake({ intensity: 8, duration: 300, elapsed: 50 });
    triggerShake(shake, 2, 100); // 2 < 8 and elapsed < duration → no override
    expect(shake.intensity).toBe(8);
    expect(shake.elapsed).toBe(50); // unchanged
  });

  it('any shake applies once the previous one expires', () =>
  {
    const shake = makeShake({ intensity: 8, duration: 300, elapsed: 300 }); // expired
    triggerShake(shake, 1, 100);
    expect(shake.intensity).toBe(1);
    expect(shake.elapsed).toBe(0);
  });
});

describe('getShakeOffset', () =>
{
  it('returns [0, 0] when shake has elapsed', () =>
  {
    const shake = makeShake({ intensity: 10, duration: 200, elapsed: 200 });
    expect(getShakeOffset(shake)).toEqual([0, 0]);
  });

  it('returns offset within [-intensity, intensity] when active', () =>
  {
    const shake = makeShake({ intensity: 10, duration: 200, elapsed: 0 });
    const [dx, dy] = getShakeOffset(shake);
    expect(Math.abs(dx)).toBeLessThanOrEqual(10);
    expect(Math.abs(dy)).toBeLessThanOrEqual(10);
  });
});

describe('updateScreenShake', () =>
{
  it('advances elapsed by deltaMs', () =>
  {
    const shake = makeShake({ intensity: 5, duration: 200, elapsed: 0 });
    updateScreenShake(shake, 50);
    expect(shake.elapsed).toBe(50);
  });

  it('clamps elapsed to duration', () =>
  {
    const shake = makeShake({ intensity: 5, duration: 200, elapsed: 190 });
    updateScreenShake(shake, 50);
    expect(shake.elapsed).toBe(200); // capped at duration
  });
});

/* ── triggerPaddleEmotion ──────────────────────────────────────────────────── */

describe('triggerPaddleEmotion', () =>
{
  it('scored=true gives upward (negative) velocity kick', () =>
  {
    const paddle = makeP1();
    triggerPaddleEmotion(paddle, true);
    // EMOTION_JUMP_PX=-5, K=18 → velocity = -5 * 18 = -90 (upward)
    expect(paddle.emotionVelocity).toBe(EMOTION_JUMP_PX * EMOTION_SPRING_K);
    expect(paddle.emotionVelocity).toBeLessThan(0);
  });

  it('scored=false gives downward (positive) velocity sag', () =>
  {
    const paddle = makeP1();
    triggerPaddleEmotion(paddle, false);
    // EMOTION_SAG_PX=8, K=18 → velocity = 8 * 18 = 144 (downward)
    expect(paddle.emotionVelocity).toBe(EMOTION_SAG_PX * EMOTION_SPRING_K);
    expect(paddle.emotionVelocity).toBeGreaterThan(0);
  });
});

/* ── Impact rings ──────────────────────────────────────────────────────────── */

describe('impact rings', () =>
{
  it('spawnImpactRing appends a ring at the given position', () =>
  {
    const rings = [] as ReturnType<typeof spawnImpactRing> extends void ? any[] : any[];
    spawnImpactRing(rings, 100, 200, '#ff0000');
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({ x: 100, y: 200, age: 0, color: '#ff0000' });
  });

  it('updateImpactRings advances age and removes expired rings', () =>
  {
    const rings: any[] = [];
    spawnImpactRing(rings, 100, 200, '#ff0000');
    updateImpactRings(rings, RING_DURATION_MS);
    expect(rings).toHaveLength(0);
  });

  it('updateImpactRings keeps rings that have not yet expired', () =>
  {
    const rings: any[] = [];
    spawnImpactRing(rings, 100, 200, '#ff0000');
    updateImpactRings(rings, RING_DURATION_MS - 1);
    expect(rings).toHaveLength(1);
  });
});

/* ── Wall marks ────────────────────────────────────────────────────────────── */

describe('wall marks', () =>
{
  it('spawnWallMark appends a mark at the given position', () =>
  {
    const marks: any[] = [];
    spawnWallMark(marks, 400, 0);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ x: 400, y: 0, age: 0 });
  });

  it('updateWallMarks removes fully-faded marks', () =>
  {
    const marks: any[] = [];
    spawnWallMark(marks, 400, 0);
    updateWallMarks(marks, WALL_MARK_FADE_MS);
    expect(marks).toHaveLength(0);
  });
});

/* ── Goal flashes ──────────────────────────────────────────────────────────── */

describe('goal flashes', () =>
{
  it('spawnGoalFlash appends the correct side', () =>
  {
    const flashes: any[] = [];
    spawnGoalFlash(flashes, 1);
    expect(flashes[0]).toMatchObject({ side: 1, age: 0 });
  });

  it('updateGoalFlashes removes expired flashes', () =>
  {
    const flashes: any[] = [];
    spawnGoalFlash(flashes, 2);
    updateGoalFlashes(flashes, GOAL_FLASH_MS);
    expect(flashes).toHaveLength(0);
  });
});

/* ── Goal particles ────────────────────────────────────────────────────────── */

describe('goal particles', () =>
{
  it('spawnGoalParticles adds GOAL_PARTICLE_COUNT particles', () =>
  {
    const particles: any[] = [];
    spawnGoalParticles(particles, 960, 270, '#ff0000', Math.PI);
    expect(particles).toHaveLength(GOAL_PARTICLE_COUNT);
  });

  it('all spawned particles start at the goal position', () =>
  {
    const particles: any[] = [];
    spawnGoalParticles(particles, 960, 270, '#ff0000', Math.PI);
    for (const p of particles)
    {
      expect(p.x).toBe(960);
      expect(p.y).toBe(270);
    }
  });

  it('updateGoalParticles removes expired particles', () =>
  {
    const particles: any[] = [];
    spawnGoalParticles(particles, 960, 270, '#ff0000', Math.PI);
    updateGoalParticles(particles, GOAL_PARTICLE_MS);
    expect(particles).toHaveLength(0);
  });

  it('updateGoalParticles applies gravity (vy increases each frame)', () =>
  {
    const particles: any[] = [];
    spawnGoalParticles(particles, 960, 270, '#ff0000', 0);
    const initialVy = particles[0].vy;
    updateGoalParticles(particles, 16);
    expect(particles[0].vy).toBeGreaterThan(initialVy);
  });
});

/* ── updatePaddleAnimations — breath phase ─────────────────────────────────── */

describe('updatePaddleAnimations', () =>
{
  it('advances breathPhase each frame', () =>
  {
    const paddle = makeP1({ breathPhase: 0 });
    updatePaddleAnimations(paddle, 16);
    expect(paddle.breathPhase).toBeGreaterThan(0);
  });

  it('recoil spring returns toward zero over time', () =>
  {
    const paddle = makeP1({ recoilOffset: 10, recoilVelocity: 0 });
    for (let i = 0; i < 30; i++) updatePaddleAnimations(paddle, 16);
    expect(Math.abs(paddle.recoilOffset)).toBeLessThan(10);
  });

  it('chromatic timer counts down to zero', () =>
  {
    const paddle = makeP1({ chromaticTimer: 50 });
    updatePaddleAnimations(paddle, 30);
    expect(paddle.chromaticTimer).toBe(20);
    updatePaddleAnimations(paddle, 30);
    expect(paddle.chromaticTimer).toBe(0);
  });
});
