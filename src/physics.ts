// PhysicsEngine — pure functions: ball movement, collision, spin, reflection

import {
  Ball, Paddle, ScreenShake, ImpactRing, WallMark, GoalFlash, GoalParticle
} from './types.js';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BALL_RADIUS, BALL_SPEED_INC, BALL_MAX_SPEED, BALL_MAX_ANGLE_DEG,
  TRAIL_INTERVAL_MS, TRAIL_LENGTH,
  SPIN_IMPART_FACTOR, SPIN_CURVE_FORCE, SPIN_DECAY_PER_S, SPIN_WALL_RETAIN,
  HITSTOP_SLOW_MS, HITSTOP_FAST_MS, HITSTOP_SPEED_THRESHOLD,
  SQUASH_DURATION_MS, STRETCH_DURATION_MS,
  PADDLE_RECOIL_PX, RECOIL_SPRING_K, RECOIL_SPRING_DAMP,
  CHROMATIC_MS, PADDLE_COLOR_FLASH_MS,
  RING_MAX_RADIUS, RING_DURATION_MS,
  SHAKE_HIT_INTENSITY, SHAKE_HIT_MS,
  EMOTION_JUMP_PX, EMOTION_SAG_PX, EMOTION_SPRING_K, EMOTION_SPRING_DAMP,
  WALL_MARK_FADE_MS,
  SERVE_ANGLE_RANGE,
  HIT_EYE_FLASH_MS,
  GOAL_FLASH_MS, GOAL_PARTICLE_MS, GOAL_PARTICLE_COUNT, GOAL_PARTICLE_GRAVITY,
  COLOR_P1, COLOR_P2,
} from './constants.js';

// ─── Ball Reset / Serve ────────────────────────────────────────────────────

/** Reset ball to center, launch toward the given side at a random angle */
export function resetBall(ball: Ball, towardLeft: boolean): void {
  ball.x = CANVAS_WIDTH / 2;
  ball.y = CANVAS_HEIGHT / 2;
  ball.spin = 0;
  ball.spinAngle = 0;
  ball.hitFlashTimer = 0;
  ball.sadTimer = 0;
  ball.speed = 300; // reset to base speed — new constants.ts BALL_BASE_SPEED

  const angleDeg = (Math.random() - 0.5) * 2 * SERVE_ANGLE_RANGE;
  const angleRad = (angleDeg * Math.PI) / 180;
  const dirX = towardLeft ? -1 : 1;

  ball.vx = Math.cos(angleRad) * ball.speed * dirX;
  ball.vy = Math.sin(angleRad) * ball.speed;

  ball.hitstopTimer = 0;
  ball.squashTimer = 0;
  ball.stretchTimer = 0;
  ball.trail = [];
  ball.trailTimer = 0;
}

// ─── Main Update ────────────────────────────────────────────────────────────

export interface PhysicsResult {
  hitPaddle: 1 | 2 | null;
  hitWall: 'top' | 'bottom' | 'right' | null;   // right = toy-mode right wall
  goal: 1 | 2 | null;                             // which player scored
}

/**
 * Advance ball physics by deltaTime seconds.
 * Mutates ball in place; returns what events happened.
 */
export function updateBall(
  ball: Ball,
  player1: Paddle,
  player2: Paddle,
  deltaMs: number,
  toyMode: boolean   // true = right wall reflects (Phase 1 toy)
): PhysicsResult {
  const result: PhysicsResult = { hitPaddle: null, hitWall: null, goal: null };
  const dt = deltaMs / 1000; // seconds

  // ── Hitstop — freeze ball and skip physics ─────────────────────────────
  if (ball.hitstopTimer > 0) {
    ball.hitstopTimer = Math.max(0, ball.hitstopTimer - deltaMs);
    if (ball.hitstopTimer === 0) {
      // Hitstop just ended — start stretch phase
      ball.stretchTimer = STRETCH_DURATION_MS;
    }
    updateTimers(ball, deltaMs);
    return result;
  }

  // ── Spin curve ────────────────────────────────────────────────────────
  ball.vy += ball.spin * SPIN_CURVE_FORCE * dt;
  ball.spin *= Math.exp(-SPIN_DECAY_PER_S * dt);

  // Accumulate visual spin angle (drives rotation of spin indicator lines)
  // Rate proportional to spin magnitude so it visibly slows as spin decays
  ball.spinAngle += ball.spin * 40 * dt;

  // ── Move ──────────────────────────────────────────────────────────────
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // ── Trail ─────────────────────────────────────────────────────────────
  ball.trailTimer += deltaMs;
  if (ball.trailTimer >= TRAIL_INTERVAL_MS) {
    ball.trailTimer = 0;
    ball.trail.unshift({ x: ball.x, y: ball.y });
    if (ball.trail.length > TRAIL_LENGTH) ball.trail.pop();
  }

  // ── Wall bounces (top / bottom) ───────────────────────────────────────
  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy);
    ball.spin *= -SPIN_WALL_RETAIN;
    result.hitWall = 'top';
  } else if (ball.y + ball.radius > CANVAS_HEIGHT) {
    ball.y = CANVAS_HEIGHT - ball.radius;
    ball.vy = -Math.abs(ball.vy);
    ball.spin *= -SPIN_WALL_RETAIN;
    result.hitWall = 'bottom';
  }

  // ── Right boundary ────────────────────────────────────────────────────
  if (ball.x + ball.radius > CANVAS_WIDTH) {
    if (toyMode) {
      // Reflect — toy mode, no opponent
      ball.x = CANVAS_WIDTH - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      ball.spin *= -SPIN_WALL_RETAIN;
      result.hitWall = 'right';
    } else {
      // Player 1 scored
      result.goal = 1;
    }
  }

  // ── Left boundary ─────────────────────────────────────────────────────
  if (ball.x - ball.radius < 0) {
    if (toyMode) {
      // Ball missed the player paddle — soft reset
      resetBall(ball, false);
    } else {
      // Player 2 scored
      result.goal = 2;
    }
  }

  // ── Paddle collisions ─────────────────────────────────────────────────
  if (!result.goal) {
    if (checkPaddleCollision(ball, player1)) {
      resolvePaddleHit(ball, player1, false); // left paddle, ball bounces right
      result.hitPaddle = 1;
    } else if (checkPaddleCollision(ball, player2)) {
      resolvePaddleHit(ball, player2, true);  // right paddle, ball bounces left
      result.hitPaddle = 2;
    }
  }

  updateTimers(ball, deltaMs);
  return result;
}

// ─── Collision ─────────────────────────────────────────────────────────────

function checkPaddleCollision(ball: Ball, paddle: Paddle): boolean {
  const px = paddle.x + paddle.recoilOffset;
  return (
    ball.x + ball.radius > px &&
    ball.x - ball.radius < px + paddle.width &&
    ball.y + ball.radius > paddle.y &&
    ball.y - ball.radius < paddle.y + paddle.height
  );
}

/**
 * Resolve paddle hit: set ball velocity, speed, spin, and trigger hit-feel state.
 * @param fromRight  true if this is the right-side paddle (ball should bounce left)
 */
function resolvePaddleHit(ball: Ball, paddle: Paddle, fromRight: boolean): void {
  // Contact position along paddle height: 0 = top edge, 1 = bottom edge, 0.5 = center
  const contact = Math.max(0, Math.min(1,
    (ball.y - paddle.y) / paddle.height
  ));
  const edgeFactor = Math.abs(contact - 0.5) * 2; // 0 = center, 1 = edge

  // Angle from horizontal: 0 at center → ±BALL_MAX_ANGLE_DEG at edges
  const maxRad = (BALL_MAX_ANGLE_DEG * Math.PI) / 180;
  const angleRad = (contact - 0.5) * 2 * maxRad;

  // Speed increase, capped at max
  ball.speed = Math.min(ball.speed + BALL_SPEED_INC, BALL_MAX_SPEED);

  const dirX = fromRight ? -1 : 1;
  ball.vx = Math.cos(angleRad) * ball.speed * dirX;
  ball.vy = Math.sin(angleRad) * ball.speed;

  // Push ball out of paddle to prevent tunneling
  if (fromRight) {
    ball.x = paddle.x + paddle.recoilOffset - ball.radius;
  } else {
    ball.x = paddle.x + paddle.recoilOffset + paddle.width + ball.radius;
  }

  // Spin from paddle velocity
  ball.spin = paddle.vy * SPIN_IMPART_FACTOR;

  // Hitstop
  ball.hitstopTimer = ball.speed >= HITSTOP_SPEED_THRESHOLD
    ? HITSTOP_FAST_MS
    : HITSTOP_SLOW_MS;
  ball.squashTimer = SQUASH_DURATION_MS;
  ball.stretchTimer = 0; // set after hitstop ends

  // Paddle recoil
  const recoilDir = fromRight ? 1 : -1;
  paddle.recoilVelocity = recoilDir * PADDLE_RECOIL_PX * RECOIL_SPRING_K;

  // Chromatic flash + color flash
  paddle.chromaticTimer   = CHROMATIC_MS;
  paddle.colorFlashTimer  = PADDLE_COLOR_FLASH_MS;

  // Eye wide reaction
  ball.hitFlashTimer = HIT_EYE_FLASH_MS;

  // Store edge factor on ball for audio (read by game.ts)
  (ball as Ball & { _edgeFactor?: number })._edgeFactor = edgeFactor;
}

// ─── Spring / Animation Updates ────────────────────────────────────────────

function updateTimers(ball: Ball, deltaMs: number): void {
  if (ball.squashTimer > 0)    ball.squashTimer    = Math.max(0, ball.squashTimer    - deltaMs);
  if (ball.stretchTimer > 0)   ball.stretchTimer   = Math.max(0, ball.stretchTimer   - deltaMs);
  if (ball.hitFlashTimer > 0)  ball.hitFlashTimer  = Math.max(0, ball.hitFlashTimer  - deltaMs);
  if (ball.sadTimer > 0)       ball.sadTimer       = Math.max(0, ball.sadTimer       - deltaMs);
}

/** Update paddle spring animations (recoil + emotion). Call each frame. */
export function updatePaddleAnimations(paddle: Paddle, deltaMs: number): void {
  const dt = deltaMs / 1000;
  const fps60 = deltaMs / (1000 / 60); // scale factor relative to 60fps

  // ── Recoil spring ────────────────────────────────────────────────────
  const recoilRestoring = -paddle.recoilOffset * RECOIL_SPRING_K;
  paddle.recoilVelocity = (paddle.recoilVelocity + recoilRestoring * dt);
  paddle.recoilOffset += paddle.recoilVelocity * dt;
  paddle.recoilVelocity *= Math.pow(RECOIL_SPRING_DAMP, fps60);
  if (Math.abs(paddle.recoilOffset) < 0.01 && Math.abs(paddle.recoilVelocity) < 0.1) {
    paddle.recoilOffset = 0;
    paddle.recoilVelocity = 0;
  }

  // ── Emotion spring ───────────────────────────────────────────────────
  const emotionRestoring = -paddle.emotionOffset * EMOTION_SPRING_K;
  paddle.emotionVelocity = (paddle.emotionVelocity + emotionRestoring * dt);
  paddle.emotionOffset += paddle.emotionVelocity * dt;
  paddle.emotionVelocity *= Math.pow(EMOTION_SPRING_DAMP, fps60);
  if (Math.abs(paddle.emotionOffset) < 0.01 && Math.abs(paddle.emotionVelocity) < 0.1) {
    paddle.emotionOffset = 0;
    paddle.emotionVelocity = 0;
  }

  // ── Chromatic timer ──────────────────────────────────────────────────
  if (paddle.chromaticTimer > 0) {
    paddle.chromaticTimer = Math.max(0, paddle.chromaticTimer - deltaMs);
  }

  // ── Color flash timer ────────────────────────────────────────────────
  if (paddle.colorFlashTimer > 0) {
    paddle.colorFlashTimer = Math.max(0, paddle.colorFlashTimer - deltaMs);
  }

  // ── Breath oscillation ───────────────────────────────────────────────
  paddle.breathPhase += 2 * Math.PI * 0.5 * dt; // 0.5 Hz
}

/** Trigger recoil on a paddle (called when hit). */
export function triggerPaddleRecoil(paddle: Paddle, fromRight: boolean): void {
  const dir = fromRight ? 1 : -1;
  paddle.recoilVelocity = dir * PADDLE_RECOIL_PX * 30;
}

/** Trigger emotion jump (scored) or sag (conceded). */
export function triggerPaddleEmotion(paddle: Paddle, scored: boolean): void {
  paddle.emotionVelocity = scored ? EMOTION_JUMP_PX * EMOTION_SPRING_K
                                  : EMOTION_SAG_PX  * EMOTION_SPRING_K;
}

/** Spawn an impact ring at the ball contact point. */
export function spawnImpactRing(rings: ImpactRing[], x: number, y: number, color: string): void {
  rings.push({ x, y, age: 0, color });
}

/** Update all impact rings; remove expired ones. */
export function updateImpactRings(rings: ImpactRing[], deltaMs: number): void {
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].age += deltaMs;
    if (rings[i].age >= RING_DURATION_MS) rings.splice(i, 1);
  }
}

/** Spawn a scorch mark at a wall contact position. */
export function spawnWallMark(marks: WallMark[], x: number, y: number): void {
  marks.push({ x, y, age: 0 });
}

/** Update wall marks; remove fully faded ones. */
export function updateWallMarks(marks: WallMark[], deltaMs: number): void {
  for (let i = marks.length - 1; i >= 0; i--) {
    marks[i].age += deltaMs;
    if (marks[i].age >= WALL_MARK_FADE_MS) marks.splice(i, 1);
  }
}

/** Update screen shake. */
export function updateScreenShake(shake: ScreenShake, deltaMs: number): void {
  if (shake.elapsed < shake.duration) {
    shake.elapsed = Math.min(shake.elapsed + deltaMs, shake.duration);
  }
}

export function triggerShake(shake: ScreenShake, intensity: number, duration: number): void {
  if (intensity >= shake.intensity || shake.elapsed >= shake.duration) {
    shake.intensity = intensity;
    shake.duration = duration;
    shake.elapsed = 0;
  }
}

/** Get current shake offset (x, y). Returns [0,0] when not shaking. */
export function getShakeOffset(shake: ScreenShake): [number, number] {
  if (shake.elapsed >= shake.duration) return [0, 0];
  const t = 1 - shake.elapsed / shake.duration;
  const magnitude = shake.intensity * t;
  return [
    (Math.random() - 0.5) * 2 * magnitude,
    (Math.random() - 0.5) * 2 * magnitude,
  ];
}

// ─── Goal Effects ───────────────────────────────────────────────────────────

export function spawnGoalFlash(flashes: GoalFlash[], side: 1 | 2): void {
  flashes.push({ side, age: 0 });
}

export function updateGoalFlashes(flashes: GoalFlash[], deltaMs: number): void {
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].age += deltaMs;
    if (flashes[i].age >= GOAL_FLASH_MS) flashes.splice(i, 1);
  }
}

/**
 * Spawn particles at the goal line. fanAngle is the direction they burst toward:
 * π = fan left (P1 scored, ball exited right wall), 0 = fan right (P2 scored).
 */
export function spawnGoalParticles(
  particles: GoalParticle[],
  goalX: number,
  ballY: number,
  color: string,
  fanAngle: number
): void {
  const halfFan = (60 * Math.PI) / 180; // ±60° = 120° fan
  for (let i = 0; i < GOAL_PARTICLE_COUNT; i++) {
    const angle = fanAngle + (Math.random() - 0.5) * 2 * halfFan;
    const speed = 120 + Math.random() * 240; // 120–360 px/s (≈ 2–6 px/frame @60fps)
    particles.push({
      x: goalX,
      y: ballY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 3,
      age: 0,
      color,
    });
  }
}

export function updateGoalParticles(particles: GoalParticle[], deltaMs: number): void {
  const dt = deltaMs / 1000;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += GOAL_PARTICLE_GRAVITY * dt;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.age += deltaMs;
    if (p.age >= GOAL_PARTICLE_MS) particles.splice(i, 1);
  }
}
