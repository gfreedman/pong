/**
 * @file physics.test.ts
 * @description Unit tests for all exported functions in physics.ts.
 *
 * SCOPE
 * -----
 * physics.ts is the ideal unit-test target because its functions are nearly
 * pure: they mutate the structs they receive but never touch the DOM, canvas,
 * or Audio API.  Every function here can be exercised in a plain Node
 * environment with no stubs required (except Math.random for shake tests).
 *
 * ORGANISATION
 * ------------
 * Test sections mirror the section dividers in physics.ts:
 *   1. resetBall
 *   2. updateBall — normal movement
 *   3. updateBall — wall bounces
 *   4. updateBall — goals
 *   5. updateBall — toy mode
 *   6. updateBall — paddle collision
 *   7. updateBall — spin physics
 *   8. Screen shake (triggerShake / updateScreenShake / getShakeOffset)
 *   9. Impact rings
 *  10. Wall marks
 *  11. Paddle animations
 *  12. Goal effects
 */

import { describe, test, expect, vi } from 'vitest';
import
{
  resetBall,
  updateBall,
  updatePaddleAnimations,
  triggerPaddleEmotion,
  spawnImpactRing,
  updateImpactRings,
  spawnWallMark,
  updateWallMarks,
  updateScreenShake,
  triggerShake,
  getShakeOffset,
  spawnGoalFlash,
  updateGoalFlashes,
  spawnGoalParticles,
  updateGoalParticles,
} from '../src/physics.js';
import
{
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BALL_BASE_SPEED, BALL_RADIUS, BALL_SPEED_INC, BALL_MAX_SPEED,
  SERVE_ANGLE_RANGE,
  STRETCH_DURATION_MS, SQUASH_DURATION_MS,
  RING_DURATION_MS,
  WALL_MARK_FADE_MS,
  GOAL_FLASH_MS, GOAL_PARTICLE_COUNT, GOAL_PARTICLE_MS, GOAL_PARTICLE_GRAVITY,
  SPIN_IMPART_FACTOR, SPIN_CURVE_FORCE,
  TRAIL_INTERVAL_MS,
  EMOTION_JUMP_PX, EMOTION_SAG_PX, EMOTION_SPRING_K,
} from '../src/constants.js';
import { ImpactRing, WallMark, GoalFlash, GoalParticle } from '../src/types.js';
import { makeBall, makeP1, makeP2, makeShake } from './helpers.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. resetBall
   ═══════════════════════════════════════════════════════════════════════════ */

describe('resetBall', () =>
{
  /** Ball is placed at the exact centre of the canvas on every reset. */
  test('centers ball at canvas midpoint', () =>
  {
    const ball = makeBall({ x: 0, y: 0 });
    resetBall(ball, false);
    expect(ball.x).toBe(CANVAS_WIDTH  / 2);
    expect(ball.y).toBe(CANVAS_HEIGHT / 2);
  });

  /** Speed resets to the base serve speed regardless of previous speed. */
  test('resets speed to BALL_BASE_SPEED', () =>
  {
    const ball = makeBall({ speed: BALL_MAX_SPEED });
    resetBall(ball, false);
    expect(ball.speed).toBe(BALL_BASE_SPEED);
  });

  /** All spin state is cleared so the new serve starts with a straight path. */
  test('clears spin and spinAngle to zero', () =>
  {
    const ball = makeBall({ spin: 5.5, spinAngle: 3.14 });
    resetBall(ball, false);
    expect(ball.spin).toBe(0);
    expect(ball.spinAngle).toBe(0);
  });

  /** Trail is emptied and all hit-feel timers are zeroed on reset. */
  test('clears trail and all hit-feel timers', () =>
  {
    const ball = makeBall(
    {
      trail:        [{ x: 100, y: 200 }],
      trailTimer:   99,
      hitstopTimer: 50,
      squashTimer:  30,
      stretchTimer: 20,
    });
    resetBall(ball, false);
    expect(ball.trail).toHaveLength(0);
    expect(ball.trailTimer).toBe(0);
    expect(ball.hitstopTimer).toBe(0);
    expect(ball.squashTimer).toBe(0);
    expect(ball.stretchTimer).toBe(0);
  });

  /** towardLeft=true → ball launched leftward (vx < 0). */
  test('launches toward left when towardLeft=true', () =>
  {
    const ball = makeBall();
    resetBall(ball, true);
    expect(ball.vx).toBeLessThan(0);
  });

  /** towardLeft=false → ball launched rightward (vx > 0). */
  test('launches toward right when towardLeft=false', () =>
  {
    const ball = makeBall();
    resetBall(ball, false);
    expect(ball.vx).toBeGreaterThan(0);
  });

  /** Launch angle must stay within ±SERVE_ANGLE_RANGE of horizontal. */
  test('launch angle stays within SERVE_ANGLE_RANGE degrees', () =>
  {
    /* Run many iterations to exercise the random angle range. */
    for (let i = 0; i < 60; i++)
    {
      const ball = makeBall();
      resetBall(ball, i % 2 === 0);
      const angleDeg = Math.abs(Math.atan2(ball.vy, Math.abs(ball.vx)) * (180 / Math.PI));
      expect(angleDeg).toBeLessThanOrEqual(SERVE_ANGLE_RANGE + 0.001);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. updateBall — normal movement
   ═══════════════════════════════════════════════════════════════════════════ */

describe('updateBall — normal movement', () =>
{
  /** Ball integrates velocity each frame (standard Euler integration). */
  test('moves ball by vx*dt and vy*dt', () =>
  {
    const ball = makeBall({ x: 480, y: 270, vx: 300, vy: 150, spin: 0 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    /* Allow for spin-curve contribution to vy (spin=0 so there is none). */
    expect(ball.x).toBeCloseTo(480 + 300 * 0.016, 1);
    expect(ball.y).toBeCloseTo(270 + 150 * 0.016, 1);
  });

  /** Ball position must NOT change on the frame hitstop is active. */
  test('does not move x/y when hitstopTimer > 0', () =>
  {
    const ball = makeBall({ x: 480, y: 270, vx: 500, vy: 200, hitstopTimer: 50 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.x).toBe(480);
    expect(ball.y).toBe(270);
  });

  /** hitstopTimer decrements by deltaMs each frame. */
  test('decrements hitstopTimer each frame', () =>
  {
    const ball = makeBall({ hitstopTimer: 50 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.hitstopTimer).toBe(34);
  });

  /** When hitstop expires, stretchTimer becomes > 0. */
  test('sets stretchTimer > 0 when hitstop expires this frame', () =>
  {
    /* hitstopTimer=10, deltaMs=16 → hits zero; stretchTimer kicks off. */
    const ball = makeBall({ hitstopTimer: 10, stretchTimer: 0 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    /* Note: updateTimers() then decrements stretchTimer by 16, so the final
       value is STRETCH_DURATION_MS - 16, still safely > 0.               */
    expect(ball.stretchTimer).toBeGreaterThan(0);
    expect(ball.stretchTimer).toBeLessThanOrEqual(STRETCH_DURATION_MS);
  });

  /** Trail accumulates a new point after enough time has elapsed. */
  test('appends trail point after TRAIL_INTERVAL_MS ms', () =>
  {
    const ball = makeBall({ trail: [], trailTimer: 0 });
    updateBall(ball, makeP1(), makeP2(), TRAIL_INTERVAL_MS, false);
    expect(ball.trail.length).toBeGreaterThan(0);
  });

  /** Trail does not accumulate before enough time has elapsed. */
  test('does not append trail before TRAIL_INTERVAL_MS has elapsed', () =>
  {
    const ball = makeBall({ trail: [], trailTimer: 0 });
    updateBall(ball, makeP1(), makeP2(), TRAIL_INTERVAL_MS - 1, false);
    expect(ball.trail).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. updateBall — wall bounces
   ═══════════════════════════════════════════════════════════════════════════ */

describe('updateBall — wall bounces', () =>
{
  /** Ball moving into the top wall reflects downward and is clamped. */
  test('top wall: vy becomes positive, ball clamped ≥ radius, hitWall = top', () =>
  {
    /* y=2, vy=-400 → ball will exit top boundary after moving. */
    const ball = makeBall({ x: 480, y: 2, vy: -400, vx: 300, spin: 0 });
    const res  = updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.y).toBeGreaterThanOrEqual(BALL_RADIUS);
    expect(res.hitWall).toBe('top');
  });

  /** Ball moving into the bottom wall reflects upward and is clamped. */
  test('bottom wall: vy becomes negative, ball clamped ≤ HEIGHT-radius, hitWall = bottom', () =>
  {
    const ball = makeBall({ x: 480, y: CANVAS_HEIGHT - 2, vy: 400, vx: 300, spin: 0 });
    const res  = updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.vy).toBeLessThan(0);
    expect(ball.y).toBeLessThanOrEqual(CANVAS_HEIGHT - BALL_RADIUS);
    expect(res.hitWall).toBe('bottom');
  });

  /** Top-wall bounce inverts spin sign and reduces its magnitude. */
  test('top wall: spin is inverted and reduced by SPIN_WALL_RETAIN', () =>
  {
    const ball = makeBall({ x: 480, y: 2, vy: -400, vx: 300, spin: 4 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.spin).toBeLessThan(0);          // inverted from positive 4
    expect(Math.abs(ball.spin)).toBeLessThan(4); // energy lost
  });

  /** Bottom-wall bounce inverts spin sign and reduces its magnitude. */
  test('bottom wall: spin is inverted and reduced by SPIN_WALL_RETAIN', () =>
  {
    const ball = makeBall({ x: 480, y: CANVAS_HEIGHT - 2, vy: 400, vx: 300, spin: -4 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.spin).toBeGreaterThan(0);        // inverted from negative -4
    expect(Math.abs(ball.spin)).toBeLessThan(4); // energy lost
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. updateBall — goals
   ═══════════════════════════════════════════════════════════════════════════ */

describe('updateBall — goals', () =>
{
  /** Ball exiting the right edge scores a point for P1. */
  test('goal = 1 when ball exits right boundary (normal mode)', () =>
  {
    const ball = makeBall({ x: CANVAS_WIDTH - 1, vx: 2000, vy: 0 });
    const res  = updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(res.goal).toBe(1);
  });

  /** Ball exiting the left edge scores a point for P2. */
  test('goal = 2 when ball exits left boundary (normal mode)', () =>
  {
    const ball = makeBall({ x: 1, vx: -2000, vy: 0 });
    const res  = updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(res.goal).toBe(2);
  });

  /** No goal fires while ball stays within the court. */
  test('goal = null when ball stays mid-court', () =>
  {
    const ball = makeBall({ x: 480, vx: 100, vy: 0 });
    const res  = updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(res.goal).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. updateBall — toy mode
   ═══════════════════════════════════════════════════════════════════════════ */

describe('updateBall — toy mode', () =>
{
  /** Right wall reflects the ball in toy mode instead of awarding a goal. */
  test('right wall reflects ball (hitWall=right, goal=null) when toyMode=true', () =>
  {
    const ball = makeBall({ x: CANVAS_WIDTH - 1, vx: 2000, vy: 0 });
    const res  = updateBall(ball, makeP1(), makeP2(), 16, true);
    expect(res.hitWall).toBe('right');
    expect(res.goal).toBeNull();
    expect(ball.vx).toBeLessThan(0); // reflected leftward
  });

  /** Left boundary resets ball to centre in toy mode (no P2 goal). */
  test('left boundary resets ball to canvas centre when toyMode=true', () =>
  {
    const ball = makeBall({ x: 1, vx: -2000, vy: 0 });
    updateBall(ball, makeP1(), makeP2(), 16, true);
    expect(ball.x).toBe(CANVAS_WIDTH  / 2);
    expect(ball.y).toBe(CANVAS_HEIGHT / 2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. updateBall — paddle collision
   ═══════════════════════════════════════════════════════════════════════════ */

describe('updateBall — paddle collision', () =>
{
  /**
   * @function ballAtLeftPaddle
   * @description Places the ball inside the left paddle's AABB with a
   *              leftward velocity so a collision is guaranteed this frame.
   */
  function ballAtLeftPaddle()
  {
    const p1   = makeP1();  // x=30, y=230, width=12, height=80
    const p2   = makeP2();
    const midY = p1.y + p1.height / 2;
    /* Centre the ball at the paddle face — guaranteed AABB overlap. */
    const ball = makeBall(
    {
      x:     p1.x + p1.width / 2,
      y:     midY,
      vx:    -200,
      vy:    0,
      speed: BALL_BASE_SPEED,
    });
    return { ball, p1, p2 };
  }

  /**
   * @function ballAtRightPaddle
   * @description Places the ball inside the right paddle's AABB with a
   *              rightward velocity so a collision is guaranteed this frame.
   */
  function ballAtRightPaddle()
  {
    const p1   = makeP1();
    const p2   = makeP2();  // x=918, width=12
    const midY = p2.y + p2.height / 2;
    const ball = makeBall(
    {
      x:     p2.x + p2.width / 2,
      y:     midY,
      vx:    200,
      vy:    0,
      speed: BALL_BASE_SPEED,
    });
    return { ball, p1, p2 };
  }

  /** Left paddle collision: hitPaddle = 1, ball vx becomes positive. */
  test('left paddle: hitPaddle = 1 and vx becomes positive', () =>
  {
    const { ball, p1, p2 } = ballAtLeftPaddle();
    const res = updateBall(ball, p1, p2, 16, false);
    expect(res.hitPaddle).toBe(1);
    expect(ball.vx).toBeGreaterThan(0);
  });

  /** Right paddle collision: hitPaddle = 2, ball vx becomes negative. */
  test('right paddle: hitPaddle = 2 and vx becomes negative', () =>
  {
    const { ball, p1, p2 } = ballAtRightPaddle();
    const res = updateBall(ball, p1, p2, 16, false);
    expect(res.hitPaddle).toBe(2);
    expect(ball.vx).toBeLessThan(0);
  });

  /** Ball is pushed outside the left paddle AABB to prevent double-hit. */
  test('ball is pushed outside left paddle after collision', () =>
  {
    const { ball, p1, p2 } = ballAtLeftPaddle();
    updateBall(ball, p1, p2, 16, false);
    /* Ball left edge must be at or past the paddle right edge. */
    expect(ball.x - ball.radius).toBeGreaterThanOrEqual(p1.x + p1.width);
  });

  /** Ball is pushed outside the right paddle AABB to prevent double-hit. */
  test('ball is pushed outside right paddle after collision', () =>
  {
    const { ball, p1, p2 } = ballAtRightPaddle();
    updateBall(ball, p1, p2, 16, false);
    /* Ball right edge must be at or before the paddle left edge. */
    expect(ball.x + ball.radius).toBeLessThanOrEqual(p2.x);
  });

  /** Collision sets both hitstopTimer and squashTimer to positive values. */
  test('collision sets hitstopTimer and squashTimer > 0', () =>
  {
    const { ball, p1, p2 } = ballAtLeftPaddle();
    updateBall(ball, p1, p2, 16, false);
    expect(ball.hitstopTimer).toBeGreaterThan(0);
    expect(ball.squashTimer).toBeGreaterThan(0);
  });

  /** Speed increases by BALL_SPEED_INC on each paddle contact. */
  test('speed increases by BALL_SPEED_INC on hit', () =>
  {
    const { ball, p1, p2 } = ballAtLeftPaddle();
    const initialSpeed = ball.speed;
    updateBall(ball, p1, p2, 16, false);
    expect(ball.speed).toBe(initialSpeed + BALL_SPEED_INC);
  });

  /** Speed does not exceed BALL_MAX_SPEED no matter how fast the ball is. */
  test('speed is capped at BALL_MAX_SPEED', () =>
  {
    const { ball, p1, p2 } = ballAtLeftPaddle();
    ball.speed = BALL_MAX_SPEED;
    updateBall(ball, p1, p2, 16, false);
    expect(ball.speed).toBe(BALL_MAX_SPEED);
  });

  /** Spin is imparted from paddle.vy at the moment of contact. */
  test('spin is imparted proportional to paddle.vy', () =>
  {
    const { ball, p1, p2 } = ballAtLeftPaddle();
    p1.vy = 200;
    updateBall(ball, p1, p2, 16, false);
    /* spin = paddle.vy * SPIN_IMPART_FACTOR */
    expect(ball.spin).toBeCloseTo(200 * SPIN_IMPART_FACTOR, 5);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. updateBall — spin physics
   ═══════════════════════════════════════════════════════════════════════════ */

describe('updateBall — spin physics', () =>
{
  /** Positive spin (topspin) accelerates vy downward. */
  test('positive spin increases vy (curves ball downward)', () =>
  {
    const ball     = makeBall({ x: 480, y: 270, vx: 300, vy: 0, spin: 10 });
    const vyBefore = ball.vy;
    updateBall(ball, makeP1(), makeP2(), 16, false);
    /* vy += spin * SPIN_CURVE_FORCE * dt = 10 * 90 * 0.016 ≈ +14.4 */
    expect(ball.vy).toBeGreaterThan(vyBefore);
  });

  /** Negative spin (backspin) accelerates vy upward. */
  test('negative spin decreases vy (curves ball upward)', () =>
  {
    const ball     = makeBall({ x: 480, y: 270, vx: 300, vy: 0, spin: -10 });
    const vyBefore = ball.vy;
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(ball.vy).toBeLessThan(vyBefore);
  });

  /** Spin magnitude decays each frame (exponential decay). */
  test('spin magnitude decreases each frame', () =>
  {
    const ball = makeBall({ x: 480, y: 270, vx: 300, vy: 0, spin: 10 });
    updateBall(ball, makeP1(), makeP2(), 16, false);
    expect(Math.abs(ball.spin)).toBeLessThan(10);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. Screen shake
   ═══════════════════════════════════════════════════════════════════════════ */

describe('triggerShake', () =>
{
  /** A new shake is set when no shake is currently running. */
  test('sets intensity, duration, and resets elapsed when no shake is active', () =>
  {
    const shake = makeShake(0, 0, 0);
    triggerShake(shake, 5, 200);
    expect(shake.intensity).toBe(5);
    expect(shake.duration).toBe(200);
    expect(shake.elapsed).toBe(0);
  });

  /** A weaker shake does NOT override a currently stronger running shake. */
  test('does not override a stronger active shake', () =>
  {
    /* intensity=8, duration=160, elapsed=50 → still running (50 < 160). */
    const shake = makeShake(8, 160, 50);
    triggerShake(shake, 3, 200); // weaker intensity
    expect(shake.intensity).toBe(8); // unchanged
  });

  /** A stronger shake DOES override a weaker active shake. */
  test('overrides a weaker shake with a stronger one', () =>
  {
    const shake = makeShake(3, 160, 50);
    triggerShake(shake, 8, 200);
    expect(shake.intensity).toBe(8);
    expect(shake.elapsed).toBe(0);
  });

  /** Any shake overrides a finished (elapsed >= duration) shake. */
  test('overrides a finished shake regardless of intensity', () =>
  {
    /* elapsed=200 >= duration=160 → shake has ended. */
    const shake = makeShake(8, 160, 200);
    triggerShake(shake, 3, 100);
    expect(shake.intensity).toBe(3);
    expect(shake.elapsed).toBe(0);
  });
});

describe('updateScreenShake', () =>
{
  /** elapsed advances by deltaMs each frame. */
  test('advances elapsed by deltaMs', () =>
  {
    const shake = makeShake(5, 200, 0);
    updateScreenShake(shake, 16);
    expect(shake.elapsed).toBe(16);
  });

  /** elapsed is clamped to duration — never overshoots. */
  test('elapsed does not exceed duration', () =>
  {
    const shake = makeShake(5, 200, 195);
    updateScreenShake(shake, 100); // would overshoot to 295
    expect(shake.elapsed).toBe(200);
  });
});

describe('getShakeOffset', () =>
{
  /** Returns [0, 0] when elapsed has reached or passed duration. */
  test('returns [0, 0] when elapsed >= duration', () =>
  {
    const shake     = makeShake(5, 160, 200); // elapsed past end
    const [dx, dy]  = getShakeOffset(shake);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  /** Returns non-zero offsets while shake is still active. */
  test('returns non-zero offsets while shaking', () =>
  {
    /* Mock Math.random to a high value so (random - 0.5)*2*magnitude ≠ 0. */
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const shake     = makeShake(10, 200, 50);
    const [dx, dy]  = getShakeOffset(shake);
    expect(Math.abs(dx)).toBeGreaterThan(0);
    expect(Math.abs(dy)).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  /** Offset magnitude is bounded by shake.intensity. */
  test('offset magnitude is bounded by intensity', () =>
  {
    const shake = makeShake(5, 200, 0); // t = 1.0, magnitude = 5
    /* Run many frames to sample the random distribution. */
    for (let i = 0; i < 50; i++)
    {
      const [dx, dy] = getShakeOffset(shake);
      expect(Math.abs(dx)).toBeLessThanOrEqual(5 + 0.001);
      expect(Math.abs(dy)).toBeLessThanOrEqual(5 + 0.001);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. Impact rings
   ═══════════════════════════════════════════════════════════════════════════ */

describe('spawnImpactRing', () =>
{
  /** A new ring is pushed with the exact properties passed. */
  test('pushes a ring with correct x, y, age=0, color', () =>
  {
    const rings: ImpactRing[] = [];
    spawnImpactRing(rings, 100, 200, '#ff0000');
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({ x: 100, y: 200, age: 0, color: '#ff0000' });
  });

  /** Multiple spawns accumulate — not replaced. */
  test('each spawn appends a new ring (does not replace existing ones)', () =>
  {
    const rings: ImpactRing[] = [];
    spawnImpactRing(rings, 0, 0, '#fff');
    spawnImpactRing(rings, 1, 1, '#fff');
    expect(rings).toHaveLength(2);
  });
});

describe('updateImpactRings', () =>
{
  /** Ring age increments by deltaMs each frame. */
  test('increments ring age each frame', () =>
  {
    const rings: ImpactRing[] = [{ x: 0, y: 0, age: 0, color: '#fff' }];
    updateImpactRings(rings, 16);
    expect(rings[0].age).toBe(16);
  });

  /** Rings that reach or exceed RING_DURATION_MS are removed. */
  test('removes rings with age >= RING_DURATION_MS', () =>
  {
    const rings: ImpactRing[] =
    [
      { x: 0, y: 0, age: RING_DURATION_MS - 1, color: '#fff' }, // not yet expired
      { x: 0, y: 0, age: RING_DURATION_MS,     color: '#fff' }, // exactly at limit
    ];
    /* deltaMs=0 so only the already-expired one (age=RING_DURATION_MS) is removed. */
    updateImpactRings(rings, 0);
    expect(rings).toHaveLength(1);
    expect(rings[0].age).toBe(RING_DURATION_MS - 1);
  });

  /** Young rings (age < RING_DURATION_MS) are kept alive. */
  test('keeps rings with age < RING_DURATION_MS', () =>
  {
    const rings: ImpactRing[] = [{ x: 0, y: 0, age: 0, color: '#fff' }];
    updateImpactRings(rings, 16); // 16 << 160
    expect(rings).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. Wall marks
   ═══════════════════════════════════════════════════════════════════════════ */

describe('spawnWallMark', () =>
{
  /** A new mark is pushed with the exact position and age=0. */
  test('pushes a mark with correct x, y, age=0', () =>
  {
    const marks: WallMark[] = [];
    spawnWallMark(marks, 300, 0);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ x: 300, y: 0, age: 0 });
  });
});

describe('updateWallMarks', () =>
{
  /** Mark age increments by deltaMs each frame. */
  test('increments mark age each frame', () =>
  {
    const marks: WallMark[] = [{ x: 0, y: 0, age: 0 }];
    updateWallMarks(marks, 100);
    expect(marks[0].age).toBe(100);
  });

  /** Marks at or past WALL_MARK_FADE_MS are removed. */
  test('removes marks with age >= WALL_MARK_FADE_MS', () =>
  {
    const marks: WallMark[] = [{ x: 0, y: 0, age: WALL_MARK_FADE_MS }];
    updateWallMarks(marks, 0); // already expired
    expect(marks).toHaveLength(0);
  });

  /** Young marks are kept. */
  test('keeps marks with age < WALL_MARK_FADE_MS', () =>
  {
    const marks: WallMark[] = [{ x: 0, y: 0, age: 0 }];
    updateWallMarks(marks, 100); // 100ms << 10000ms
    expect(marks).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. Paddle animations
   ═══════════════════════════════════════════════════════════════════════════ */

describe('triggerPaddleEmotion', () =>
{
  /** scored=true kicks the emotion spring upward (negative velocity in canvas Y). */
  test('scored=true sets emotionVelocity to EMOTION_JUMP_PX * EMOTION_SPRING_K', () =>
  {
    const p = makeP1();
    triggerPaddleEmotion(p, true);
    expect(p.emotionVelocity).toBe(EMOTION_JUMP_PX * EMOTION_SPRING_K);
    expect(p.emotionVelocity).toBeLessThan(0); // jump = upward = negative Y
  });

  /** scored=false kicks the emotion spring downward (positive velocity in canvas Y). */
  test('scored=false sets emotionVelocity to EMOTION_SAG_PX * EMOTION_SPRING_K', () =>
  {
    const p = makeP1();
    triggerPaddleEmotion(p, false);
    expect(p.emotionVelocity).toBe(EMOTION_SAG_PX * EMOTION_SPRING_K);
    expect(p.emotionVelocity).toBeGreaterThan(0); // sag = downward = positive Y
  });
});

describe('updatePaddleAnimations', () =>
{
  /** breathPhase advances every frame (0.5 Hz oscillation). */
  test('advances breathPhase each frame', () =>
  {
    const p = makeP1({ breathPhase: 0 });
    updatePaddleAnimations(p, 16);
    expect(p.breathPhase).toBeGreaterThan(0);
  });

  /** Recoil spring damps to zero over many frames. */
  test('recoil spring returns to zero over many frames', () =>
  {
    /* Use a moderate initial velocity — 500px/s would take > 2s to settle. */
    const p = makeP1({ recoilVelocity: 80, recoilOffset: 0 });
    /* 5 seconds at 60fps (300 frames) is well beyond the settle time. */
    for (let i = 0; i < 300; i++) updatePaddleAnimations(p, 16);
    expect(Math.abs(p.recoilOffset)).toBeLessThan(0.5);
    expect(Math.abs(p.recoilVelocity)).toBeLessThan(0.5);
  });

  /** chromaticTimer counts down each frame. */
  test('decrements chromaticTimer each frame', () =>
  {
    const p = makeP1({ chromaticTimer: 50 });
    updatePaddleAnimations(p, 16);
    expect(p.chromaticTimer).toBe(34);
  });

  /** colorFlashTimer counts down each frame. */
  test('decrements colorFlashTimer each frame', () =>
  {
    const p = makeP1({ colorFlashTimer: 100 });
    updatePaddleAnimations(p, 16);
    expect(p.colorFlashTimer).toBe(84);
  });

  /** timers are clamped to zero, not allowed to go negative. */
  test('timers clamp to zero and do not go negative', () =>
  {
    const p = makeP1({ chromaticTimer: 5, colorFlashTimer: 5 });
    updatePaddleAnimations(p, 100); // deltaMs >> timer value
    expect(p.chromaticTimer).toBe(0);
    expect(p.colorFlashTimer).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   12. Goal effects
   ═══════════════════════════════════════════════════════════════════════════ */

describe('spawnGoalFlash', () =>
{
  /** A new flash is pushed with the correct side and age=0. */
  test('pushes a flash with side=1 and age=0', () =>
  {
    const flashes: GoalFlash[] = [];
    spawnGoalFlash(flashes, 1);
    expect(flashes).toHaveLength(1);
    expect(flashes[0]).toMatchObject({ side: 1, age: 0 });
  });

  test('pushes a flash with side=2 and age=0', () =>
  {
    const flashes: GoalFlash[] = [];
    spawnGoalFlash(flashes, 2);
    expect(flashes[0]).toMatchObject({ side: 2, age: 0 });
  });
});

describe('updateGoalFlashes', () =>
{
  /** Flash at exactly GOAL_FLASH_MS is removed on next update. */
  test('removes flash when age reaches GOAL_FLASH_MS', () =>
  {
    const flashes: GoalFlash[] = [{ side: 1, age: GOAL_FLASH_MS - 1 }];
    updateGoalFlashes(flashes, 1); // age becomes GOAL_FLASH_MS → removed
    expect(flashes).toHaveLength(0);
  });

  /** Young flashes below threshold are kept alive. */
  test('keeps flashes with age < GOAL_FLASH_MS', () =>
  {
    const flashes: GoalFlash[] = [{ side: 1, age: 0 }];
    updateGoalFlashes(flashes, 10);
    expect(flashes).toHaveLength(1);
  });
});

describe('spawnGoalParticles', () =>
{
  /** Exactly GOAL_PARTICLE_COUNT particles are spawned per goal. */
  test('creates exactly GOAL_PARTICLE_COUNT particles', () =>
  {
    const particles: GoalParticle[] = [];
    spawnGoalParticles(particles, 0, CANVAS_HEIGHT / 2, '#00f0ff', Math.PI);
    expect(particles).toHaveLength(GOAL_PARTICLE_COUNT);
  });

  /** All spawned particles start at age=0 with the given color. */
  test('all particles start at age=0 with the given color', () =>
  {
    const particles: GoalParticle[] = [];
    spawnGoalParticles(particles, 100, 270, '#ff0000', 0);
    expect(particles.every(p => p.age === 0)).toBe(true);
    expect(particles.every(p => p.color === '#ff0000')).toBe(true);
  });

  /** Particles are spawned at the goal line position. */
  test('particles originate at the goalX, ballY position', () =>
  {
    const particles: GoalParticle[] = [];
    spawnGoalParticles(particles, 960, 200, '#fff', 0);
    expect(particles.every(p => p.x === 960)).toBe(true);
    expect(particles.every(p => p.y === 200)).toBe(true);
  });
});

describe('updateGoalParticles', () =>
{
  /** Gravity increases vy downward each frame. */
  test('applies gravity: vy increases by GOAL_PARTICLE_GRAVITY * dt', () =>
  {
    const particles: GoalParticle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, size: 2, age: 0, color: '#fff' },
    ];
    updateGoalParticles(particles, 16);
    /* vy += GOAL_PARTICLE_GRAVITY * 0.016 = 150 * 0.016 = 2.4 */
    expect(particles[0].vy).toBeCloseTo(GOAL_PARTICLE_GRAVITY * 0.016, 3);
  });

  /** Particles whose age reaches GOAL_PARTICLE_MS are removed. */
  test('removes particles when age >= GOAL_PARTICLE_MS', () =>
  {
    const particles: GoalParticle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, size: 2, age: GOAL_PARTICLE_MS, color: '#fff' },
    ];
    updateGoalParticles(particles, 0);
    expect(particles).toHaveLength(0);
  });

  /** Young particles (well below lifetime) are kept alive. */
  test('keeps young particles alive', () =>
  {
    const particles: GoalParticle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, size: 2, age: 0, color: '#fff' },
    ];
    updateGoalParticles(particles, 16);
    expect(particles).toHaveLength(1);
  });

  /** Particle position integrates vx and vy each frame. */
  test('integrates particle position by velocity * dt', () =>
  {
    const particles: GoalParticle[] = [
      { x: 100, y: 100, vx: 60, vy: 0, size: 2, age: 0, color: '#fff' },
    ];
    updateGoalParticles(particles, 16);
    /* x += 60 * 0.016 = 0.96; vy += gravity; y += vy*dt */
    expect(particles[0].x).toBeCloseTo(100 + 60 * 0.016, 2);
  });
});
