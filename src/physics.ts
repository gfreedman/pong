/**
 * @file physics.ts
 * @description Pure physics functions for Neon Pong.
 *
 * DESIGN PHILOSOPHY — PURE FUNCTIONS
 * ------------------------------------
 * This file contains only *pure* functions (well, nearly pure — they mutate
 * the structs they receive, but they never own state themselves and never
 * touch the DOM, Audio API, or canvas).
 *
 * The benefit: the Game class can call these functions each frame and reason
 * clearly about what changed.  There are no hidden side effects.
 *
 * COORDINATE SYSTEM
 * -----------------
 *   (0, 0) is the top-left corner of the canvas.
 *   X increases to the right.
 *   Y increases DOWNWARD.
 *
 *   Left paddle  (P1) is near x = PADDLE_MARGIN.
 *   Right paddle (P2) is near x = CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH.
 *
 * DELTA-TIME PHYSICS
 * ------------------
 * All velocities are in *pixels per second* (px/s).  Each frame we multiply
 * by `deltaMs / 1000` (dt in seconds) before integrating into position.
 * This means the physics behave the same at 30fps and 120fps.
 *
 * EXCEPTION: PADDLE_ACCEL is intentionally per-frame (not per-second) to give
 * the paddle an arcade-snappy feel that feels better than the normalized version.
 */

import
{
  Ball, Paddle, ScreenShake, ImpactRing, WallMark, GoalFlash, GoalParticle
} from './types.js';
import
{
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BALL_RADIUS, BALL_BASE_SPEED, BALL_SPEED_INC, BALL_MAX_SPEED, BALL_MAX_ANGLE_DEG,
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

/* ═══════════════════════════════════════════════════════════════════════════
   BALL RESET / SERVE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function resetBall
 * @description Places the ball at the center of the court and launches it
 *              toward the specified side at a random angle.
 *
 *              All hit-feel timers (hitstop, squash, stretch) are cleared so
 *              the new serve starts from a clean visual state.
 *
 * @param ball        The Ball object to reset (mutated in place).
 * @param towardLeft  true = ball launches left (toward P1); false = toward P2.
 */
export function resetBall(ball: Ball, towardLeft: boolean): void
{
  /* ── Center the ball ── */
  ball.x = CANVAS_WIDTH  / 2;
  ball.y = CANVAS_HEIGHT / 2;

  /* ── Clear all spin and expression state ── */
  ball.spin      = 0;
  ball.spinAngle = 0;
  ball.hitFlashTimer = 0;
  ball.sadTimer      = 0;

  /* ── Reset to base speed ── */
  ball.speed = BALL_BASE_SPEED; // each rally starts fresh

  /* ── Compute launch angle ──────────────────────────────────────────────
     Random angle within ±SERVE_ANGLE_RANGE degrees from horizontal.
     Math.cos gives the horizontal component, Math.sin gives vertical.   */
  const angleDeg = (Math.random() - 0.5) * 2 * SERVE_ANGLE_RANGE;
  const angleRad = (angleDeg * Math.PI) / 180;
  const dirX     = towardLeft ? -1 : 1;

  ball.vx = Math.cos(angleRad) * ball.speed * dirX;
  ball.vy = Math.sin(angleRad) * ball.speed;

  /* ── Clear all deformation and trail state ── */
  ball.hitstopTimer = 0;
  ball.squashTimer  = 0;
  ball.stretchTimer = 0;
  ball.trail        = [];
  ball.trailTimer   = 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHYSICS RESULT
   The return value of updateBall() tells the Game what events happened this
   frame so it can trigger sounds, update scores, etc.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @interface PhysicsResult
 * @description What happened during the most recent updateBall() call.
 *              The Game reads this to trigger sounds and state transitions.
 */
export interface PhysicsResult
{
  /** Which paddle (1 or 2) the ball hit this frame, or null. */
  hitPaddle: 1 | 2 | null;

  /**
   * Which wall the ball bounced off this frame, or null.
   * 'right' only occurs in toy mode (single-paddle practice).
   */
  hitWall: 'top' | 'bottom' | 'right' | null;

  /**
   * Which player *scored* a point this frame, or null.
   * goal = 1 means P1 scored (ball exited right boundary).
   * goal = 2 means P2 scored (ball exited left boundary).
   */
  goal: 1 | 2 | null;

  /**
   * How far from center the ball struck the paddle (0 = dead center, 1 = extreme edge).
   * Only meaningful when hitPaddle !== null; 0 otherwise.
   * Passed to AudioManager.playPaddleHit() to select the edge-hit sound variant.
   */
  edgeFactor: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN BALL UPDATE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function updateBall
 * @description Advances the ball's physics by one frame and returns a summary
 *              of what events occurred.
 *
 * Order of operations each frame:
 *   1. Hitstop check  — if the ball is frozen, only advance timers.
 *   2. Spin curve     — apply vy force from spin, decay spin.
 *   3. Integrate      — move ball by (vx, vy) * dt.
 *   4. Trail          — append to motion trail ring buffer.
 *   5. Wall bounces   — reflect vy at top/bottom edges.
 *   6. Boundary goals — detect ball exiting left/right edges.
 *   7. Paddle collide — detect and resolve ball–paddle overlap.
 *   8. Timers         — advance squash/stretch/hitFlash/sadTimer.
 *
 * @param ball       The ball to update (mutated in place).
 * @param player1    Left paddle (P1, human).
 * @param player2    Right paddle (P2, AI).
 * @param deltaMs    Milliseconds since last frame.
 * @param toyMode    true = right wall reflects (Phase 1 single-paddle practice).
 * @returns {PhysicsResult} Events that occurred this frame.
 */
export function updateBall(
  ball: Ball,
  player1: Paddle,
  player2: Paddle,
  deltaMs: number,
  toyMode: boolean
): PhysicsResult
{
  const result: PhysicsResult = { hitPaddle: null, hitWall: null, goal: null, edgeFactor: 0 };
  const dt = deltaMs / 1000; // convert ms → seconds for velocity integration

  /* ── 1. Hitstop ───────────────────────────────────────────────────────
     Hitstop freezes ball movement for 2–3 frames after a paddle hit so
     the collision "registers" visually before the ball flies away.
     While frozen, we still advance animation timers (so squash plays).  */
  if (ball.hitstopTimer > 0)
  {
    ball.hitstopTimer = Math.max(0, ball.hitstopTimer - deltaMs);

    /* When hitstop finishes, kick off the stretch deformation. */
    if (ball.hitstopTimer === 0)
    {
      ball.stretchTimer = STRETCH_DURATION_MS;
    }

    updateTimers(ball, deltaMs);
    return result; // skip all movement this frame
  }

  /* ── 2. Spin curve ────────────────────────────────────────────────────
     Spin applies a continuous vy force, curving the ball's path.
     Positive spin = topspin (pushes ball down).
     Negative spin = backspin (pushes ball up).
     Spin decays exponentially so the curve fades naturally.             */
  ball.vy         += ball.spin * SPIN_CURVE_FORCE * dt;
  ball.spin       *= Math.exp(-SPIN_DECAY_PER_S * dt);

  /* Advance visual spin angle for the spin-indicator lines on the ball.
     Rate is proportional to spin magnitude so it slows as spin decays. */
  ball.spinAngle  += ball.spin * 40 * dt;

  /* ── 3. Integrate position ────────────────────────────────────────────
     Standard Euler integration: position += velocity × time.           */
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  /* ── 4. Trail ─────────────────────────────────────────────────────────
     Every TRAIL_INTERVAL_MS ms we capture the current position into a
     sliding window (newest at index 0).  The renderer draws a fading
     streak through these points.                                         */
  ball.trailTimer += deltaMs;
  if (ball.trailTimer >= TRAIL_INTERVAL_MS)
  {
    ball.trailTimer = 0;
    ball.trail.unshift({ x: ball.x, y: ball.y }); // newest at index 0
    if (ball.trail.length > TRAIL_LENGTH) ball.trail.pop(); // discard oldest
  }

  /* ── 5. Wall bounces (top / bottom) ──────────────────────────────────
     Clamp the ball to the boundary and reflect vy.
     Spin is partially absorbed by the wall (realistic energy loss).     */
  if (ball.y - ball.radius < 0)
  {
    ball.y      = ball.radius;
    ball.vy     = Math.abs(ball.vy);  // bounce downward
    ball.spin  *= -SPIN_WALL_RETAIN;  // invert + reduce spin
    result.hitWall = 'top';
  }
  else if (ball.y + ball.radius > CANVAS_HEIGHT)
  {
    ball.y      = CANVAS_HEIGHT - ball.radius;
    ball.vy     = -Math.abs(ball.vy); // bounce upward
    ball.spin  *= -SPIN_WALL_RETAIN;
    result.hitWall = 'bottom';
  }

  /* ── 6. Horizontal boundary events ───────────────────────────────────
     Right boundary: P1 scores in normal mode; ball reflects in toy mode.
     Left  boundary: P2 scores in normal mode; silent reset in toy mode. */
  if (ball.x + ball.radius > CANVAS_WIDTH)
  {
    if (toyMode)
    {
      /* Toy mode (Phase 1): no opponent, right wall reflects. */
      ball.x  = CANVAS_WIDTH - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      ball.spin *= -SPIN_WALL_RETAIN;
      result.hitWall = 'right';
    }
    else
    {
      result.goal = 1; // P1 scored — ball exited right side
    }
  }

  if (ball.x - ball.radius < 0)
  {
    if (toyMode)
    {
      /* Ball missed the player paddle in toy mode — soft reset to centre. */
      resetBall(ball, false);
    }
    else
    {
      result.goal = 2; // P2 scored — ball exited left side
    }
  }

  /* ── 7. Paddle collision detection and resolution ─────────────────────
     Only check if no goal was already scored this frame (avoids resolving
     a collision on a ball that is already "dead").                       */
  if (!result.goal)
  {
    if (checkPaddleCollision(ball, player1))
    {
      result.edgeFactor = resolvePaddleHit(ball, player1, false); // left paddle → ball bounces right
      result.hitPaddle  = 1;
    }
    else if (checkPaddleCollision(ball, player2))
    {
      result.edgeFactor = resolvePaddleHit(ball, player2, true);  // right paddle → ball bounces left
      result.hitPaddle  = 2;
    }
  }

  /* ── 8. Advance animation timers ──────────────────────────────────────
     Squash, stretch, hit-flash, and sad-face timers count down each frame. */
  updateTimers(ball, deltaMs);

  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   COLLISION DETECTION & RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function checkPaddleCollision
 * @description Axis-Aligned Bounding Box (AABB) overlap test between the ball
 *              circle and a paddle rectangle.
 *
 *              The recoilOffset is included in the paddle's effective X position
 *              so the visual position matches the collision detection.
 *
 * @param ball    The ball.
 * @param paddle  The paddle to test against.
 * @returns {boolean} true if the ball and paddle are overlapping.
 */
function checkPaddleCollision(ball: Ball, paddle: Paddle): boolean
{
  /* Apply the recoil offset — the paddle face visually recoils on hit,
     and the collision surface should match that visual position.         */
  const px = paddle.x + paddle.recoilOffset;

  return (
    ball.x + ball.radius > px             &&  // ball right edge past paddle left
    ball.x - ball.radius < px + paddle.width &&  // ball left edge before paddle right
    ball.y + ball.radius > paddle.y        &&  // ball bottom past paddle top
    ball.y - ball.radius < paddle.y + paddle.height  // ball top before paddle bottom
  );
}

/**
 * @function resolvePaddleHit
 * @description Resolves a ball–paddle collision by:
 *   1. Computing the contact point along the paddle face (0 = top, 1 = bottom).
 *   2. Mapping contact position to an outbound angle (center = straight, edge = steep).
 *   3. Increasing ball speed (capped at BALL_MAX_SPEED).
 *   4. Pushing the ball outside the paddle to prevent re-collision.
 *   5. Imparting spin from the paddle's vertical velocity.
 *   6. Triggering all hit-feel timers (hitstop, squash, recoil, chromatic, color-flash).
 *
 * @param ball       The ball (mutated in place).
 * @param paddle     The paddle that was hit (mutated in place for animation state).
 * @param fromRight  true if this is the right paddle (ball should bounce leftward).
 */
function resolvePaddleHit(ball: Ball, paddle: Paddle, fromRight: boolean): number
{
  /* ── Contact position (0 = top, 1 = bottom, 0.5 = center) ── */
  const contact    = Math.max(0, Math.min(1, (ball.y - paddle.y) / paddle.height));

  /* edgeFactor: 0 = center hit, 1 = extreme edge hit.
     Returned to updateBall() → PhysicsResult so Game can pass it to audio.  */
  const edgeFactor = Math.abs(contact - 0.5) * 2;

  /* ── Compute outbound angle ── */
  /* Contact 0.5 (center) → angle 0 (straight).
     Contact 0 or 1 (edges) → angle ±BALL_MAX_ANGLE_DEG.
     This is the main "feel" of pong — where you hit determines where it goes. */
  const maxRad  = (BALL_MAX_ANGLE_DEG * Math.PI) / 180;
  const angleRad = (contact - 0.5) * 2 * maxRad;

  /* ── Speed increase ── */
  ball.speed = Math.min(ball.speed + BALL_SPEED_INC, BALL_MAX_SPEED);

  /* ── Set velocity ── */
  const dirX = fromRight ? -1 : 1;
  ball.vx    = Math.cos(angleRad) * ball.speed * dirX;
  ball.vy    = Math.sin(angleRad) * ball.speed;

  /* ── Push ball outside the paddle ──────────────────────────────────────
     Without this, the ball can overlap the paddle on the next frame and
     trigger a second hit (double-hit bug).  We push it just outside.    */
  if (fromRight)
  {
    ball.x = paddle.x + paddle.recoilOffset - ball.radius;
  }
  else
  {
    ball.x = paddle.x + paddle.recoilOffset + paddle.width + ball.radius;
  }

  /* ── Spin impartment ──────────────────────────────────────────────────
     Moving the paddle up while hitting imparts backspin (ball curves up).
     Moving it down imparts topspin (ball curves down).
     SPIN_IMPART_FACTOR keeps the magnitude reasonable.                  */
  ball.spin = paddle.vy * SPIN_IMPART_FACTOR;

  /* ── Hitstop ──────────────────────────────────────────────────────────
     Freeze the ball for 2–3 frames so the hit "registers" visually.
     Fast balls (above threshold) get 3 frames; slow balls get 2.        */
  ball.hitstopTimer =
    ball.speed >= HITSTOP_SPEED_THRESHOLD ? HITSTOP_FAST_MS : HITSTOP_SLOW_MS;

  /* Squash starts immediately; stretch starts after hitstop ends. */
  ball.squashTimer  = SQUASH_DURATION_MS;
  ball.stretchTimer = 0;

  /* ── Paddle recoil ────────────────────────────────────────────────────
     Kick the recoil spring — the paddle appears to physically recoil
     away from the ball, then spring back.                               */
  const recoilDir = fromRight ? 1 : -1;
  paddle.recoilVelocity = recoilDir * PADDLE_RECOIL_PX * RECOIL_SPRING_K;

  /* ── Visual flash effects ── */
  paddle.chromaticTimer  = CHROMATIC_MS;           // RGB channel split
  paddle.colorFlashTimer = PADDLE_COLOR_FLASH_MS;  // blue → orange → blue

  /* ── Ball face reaction ── */
  ball.hitFlashTimer = HIT_EYE_FLASH_MS; // eye widens for ~4 frames

  return edgeFactor;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TIMER HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function updateTimers
 * @description Advances all ball animation timers toward zero each frame.
 *              Called at the end of updateBall() regardless of hitstop.
 *
 * @param ball     The ball whose timers to advance.
 * @param deltaMs  Milliseconds elapsed.
 */
function updateTimers(ball: Ball, deltaMs: number): void
{
  if (ball.squashTimer   > 0) ball.squashTimer   = Math.max(0, ball.squashTimer   - deltaMs);
  if (ball.stretchTimer  > 0) ball.stretchTimer  = Math.max(0, ball.stretchTimer  - deltaMs);
  if (ball.hitFlashTimer > 0) ball.hitFlashTimer = Math.max(0, ball.hitFlashTimer - deltaMs);
  if (ball.sadTimer      > 0) ball.sadTimer      = Math.max(0, ball.sadTimer      - deltaMs);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PADDLE ANIMATIONS
   Spring-based recoil and emotion animations that run every frame.
   These are purely cosmetic — they don't affect collision detection.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function updatePaddleAnimations
 * @description Advances all spring-based paddle animations by one frame.
 *
 * Animations updated:
 *   - Recoil spring    (paddle pushes back on hit, springs forward)
 *   - Emotion spring   (paddle jumps on score, sags on concede)
 *   - Chromatic timer  (RGB channel-split flash duration)
 *   - Color-flash timer (blue → orange → blue on hit)
 *   - Breath phase     (0.5 Hz idle height oscillation)
 *
 * Spring model: F = -K * displacement, damped each frame.
 * fps60 normalizes damping so it behaves the same at any frame rate.
 *
 * @param paddle   The paddle to animate (mutated in place).
 * @param deltaMs  Milliseconds since last frame.
 */
export function updatePaddleAnimations(paddle: Paddle, deltaMs: number): void
{
  const dt    = deltaMs / 1000;
  /* fps60: scale damping so a 60fps-tuned damping constant works at any FPS.
     e.g. at 30fps, fps60 = 2 → damping applied twice per logical frame.     */
  const fps60 = deltaMs / (1000 / 60);

  /* ── Recoil spring ────────────────────────────────────────────────────
     The paddle face is displaced by `recoilOffset` and springs back.
     restoring force = -K * offset (pulls toward zero).                  */
  const recoilRestoring  = -paddle.recoilOffset * RECOIL_SPRING_K;
  paddle.recoilVelocity  = paddle.recoilVelocity + recoilRestoring * dt;
  paddle.recoilOffset   += paddle.recoilVelocity * dt;
  paddle.recoilVelocity *= Math.pow(RECOIL_SPRING_DAMP, fps60); // apply damping

  /* Snap to rest when nearly settled (avoids infinite tiny oscillation). */
  if (Math.abs(paddle.recoilOffset) < 0.01 && Math.abs(paddle.recoilVelocity) < 0.1)
  {
    paddle.recoilOffset   = 0;
    paddle.recoilVelocity = 0;
  }

  /* ── Emotion spring ───────────────────────────────────────────────────
     Exactly the same spring model as recoil, but for the vertical
     "emotion" offset (jump on score / sag on concede).                  */
  const emotionRestoring   = -paddle.emotionOffset * EMOTION_SPRING_K;
  paddle.emotionVelocity   = paddle.emotionVelocity + emotionRestoring * dt;
  paddle.emotionOffset    += paddle.emotionVelocity * dt;
  paddle.emotionVelocity  *= Math.pow(EMOTION_SPRING_DAMP, fps60);

  if (Math.abs(paddle.emotionOffset) < 0.01 && Math.abs(paddle.emotionVelocity) < 0.1)
  {
    paddle.emotionOffset   = 0;
    paddle.emotionVelocity = 0;
  }

  /* ── Chromatic timer countdown ── */
  if (paddle.chromaticTimer > 0)
  {
    paddle.chromaticTimer = Math.max(0, paddle.chromaticTimer - deltaMs);
  }

  /* ── Color-flash timer countdown ── */
  if (paddle.colorFlashTimer > 0)
  {
    paddle.colorFlashTimer = Math.max(0, paddle.colorFlashTimer - deltaMs);
  }

  /* ── Breathing oscillation ────────────────────────────────────────────
     The phase angle advances at 0.5 Hz (one full breath every 2 seconds).
     The renderer uses sin(breathPhase) × BREATH_AMP_PX to modulate height. */
  paddle.breathPhase += 2 * Math.PI * 0.5 * dt;
}

/**
 * @function triggerPaddleEmotion
 * @description Kicks the emotion spring for a score or concede reaction.
 *
 * @param paddle   The paddle that scored or conceded.
 * @param scored   true = paddle's player scored (jump up); false = conceded (sag).
 */
export function triggerPaddleEmotion(paddle: Paddle, scored: boolean): void
{
  paddle.emotionVelocity = scored
    ? EMOTION_JUMP_PX * EMOTION_SPRING_K   // upward kick
    : EMOTION_SAG_PX  * EMOTION_SPRING_K;  // downward sag
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMPACT RINGS
   Expanding rings that emanate from ball–paddle contact points.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function spawnImpactRing
 * @description Adds a new impact ring to the active ring list.
 *
 * @param rings  The array of active rings.
 * @param x      Center X of the ring (px).
 * @param y      Center Y of the ring (px).
 * @param color  CSS color string for the ring glow.
 */
export function spawnImpactRing(
  rings: ImpactRing[],
  x: number,
  y: number,
  color: string
): void
{
  rings.push({ x, y, age: 0, color });
}

/**
 * @function updateImpactRings
 * @description Advances all ring ages and removes expired ones.
 *
 * @param rings    The active rings array (mutated in place).
 * @param deltaMs  Milliseconds elapsed.
 */
export function updateImpactRings(rings: ImpactRing[], deltaMs: number): void
{
  /* Iterate backwards so splice() doesn't skip elements. */
  for (let i = rings.length - 1; i >= 0; i--)
  {
    rings[i].age += deltaMs;
    if (rings[i].age >= RING_DURATION_MS) rings.splice(i, 1);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   WALL MARKS
   Scorch marks left on top/bottom walls when the ball bounces.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function spawnWallMark
 * @description Adds a new scorch mark at a wall-bounce position.
 *
 * @param marks  The active wall marks array.
 * @param x      X position of the mark (ball center at impact).
 * @param y      Y position (top or bottom boundary, px).
 */
export function spawnWallMark(marks: WallMark[], x: number, y: number): void
{
  marks.push({ x, y, age: 0 });
}

/**
 * @function updateWallMarks
 * @description Advances all mark ages and removes fully faded ones.
 *
 * @param marks    The active marks array (mutated in place).
 * @param deltaMs  Milliseconds elapsed.
 */
export function updateWallMarks(marks: WallMark[], deltaMs: number): void
{
  for (let i = marks.length - 1; i >= 0; i--)
  {
    marks[i].age += deltaMs;
    if (marks[i].age >= WALL_MARK_FADE_MS) marks.splice(i, 1);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN SHAKE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function updateScreenShake
 * @description Advances the shake elapsed timer.  Must be called every frame.
 *
 * @param shake    The ScreenShake state object (mutated in place).
 * @param deltaMs  Milliseconds elapsed.
 */
export function updateScreenShake(shake: ScreenShake, deltaMs: number): void
{
  if (shake.elapsed < shake.duration)
  {
    shake.elapsed = Math.min(shake.elapsed + deltaMs, shake.duration);
  }
}

/**
 * @function triggerShake
 * @description Starts a new screen shake, or replaces an existing weaker one.
 *              A stronger shake (higher intensity) always wins over a weaker one
 *              that is still running.
 *
 * @param shake      The ScreenShake state to update.
 * @param intensity  Peak pixel displacement.
 * @param duration   Total duration in ms.
 */
export function triggerShake(
  shake: ScreenShake,
  intensity: number,
  duration: number
): void
{
  /* Only override the current shake if this one is stronger or has ended. */
  if (intensity >= shake.intensity || shake.elapsed >= shake.duration)
  {
    shake.intensity = intensity;
    shake.duration  = duration;
    shake.elapsed   = 0;
  }
}

/**
 * @function getShakeOffset
 * @description Samples the current random shake displacement.
 *              The magnitude decays linearly from intensity to 0 over duration.
 *              Returns [0, 0] when the shake has finished.
 *
 * @param shake  Current shake state.
 * @returns {[number, number]} [dx, dy] random pixel offsets for this frame.
 */
export function getShakeOffset(shake: ScreenShake): [number, number]
{
  /* If elapsed ≥ duration, the shake is done. */
  if (shake.elapsed >= shake.duration) return [0, 0];

  /* Linear decay: t goes from 1 (start) to 0 (end). */
  const t         = 1 - shake.elapsed / shake.duration;
  const magnitude = shake.intensity * t;

  return [
    (Math.random() - 0.5) * 2 * magnitude,
    (Math.random() - 0.5) * 2 * magnitude,
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
   GOAL EFFECTS
   Visual fanfare spawned when a goal is scored.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function spawnGoalFlash
 * @description Adds a half-court white flash for the scoring side.
 *
 * @param flashes  Active goal flashes array.
 * @param side     1 = right half flashes (P1 scored); 2 = left half (P2 scored).
 */
export function spawnGoalFlash(flashes: GoalFlash[], side: 1 | 2): void
{
  flashes.push({ side, age: 0 });
}

/**
 * @function updateGoalFlashes
 * @description Advances flash ages and removes expired flashes.
 *
 * @param flashes  Active goal flashes array (mutated in place).
 * @param deltaMs  Milliseconds elapsed.
 */
export function updateGoalFlashes(flashes: GoalFlash[], deltaMs: number): void
{
  for (let i = flashes.length - 1; i >= 0; i--)
  {
    flashes[i].age += deltaMs;
    if (flashes[i].age >= GOAL_FLASH_MS) flashes.splice(i, 1);
  }
}

/**
 * @function spawnGoalParticles
 * @description Spawns a burst of particles at the goal line.
 *              Particles fan outward in a 120° arc in the `fanAngle` direction.
 *
 * @param particles  Active particles array (appended to).
 * @param goalX      X position of the goal line (left or right edge).
 * @param ballY      Y position of the ball when it crossed the line.
 * @param color      Particle color (matches the scoring player's color).
 * @param fanAngle   Direction of the burst fan (radians).
 *                   π = fan leftward (P1 scored); 0 = fan rightward (P2 scored).
 */
export function spawnGoalParticles(
  particles: GoalParticle[],
  goalX: number,
  ballY: number,
  color: string,
  fanAngle: number
): void
{
  const halfFan = (60 * Math.PI) / 180; // ±60° = 120° total fan spread

  for (let i = 0; i < GOAL_PARTICLE_COUNT; i++)
  {
    /* Random angle within the fan. */
    const angle = fanAngle + (Math.random() - 0.5) * 2 * halfFan;

    /* Random speed (2–6 px/frame @ 60fps). */
    const speed = 120 + Math.random() * 240; // px/s

    particles.push(
    {
      x:     goalX,
      y:     ballY,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed,
      size:  2 + Math.random() * 3,
      age:   0,
      color,
    });
  }
}

/**
 * @function updateGoalParticles
 * @description Advances all particle positions under gravity and removes
 *              particles that have exceeded their lifetime.
 *
 * @param particles  Active particles array (mutated in place).
 * @param deltaMs    Milliseconds elapsed.
 */
export function updateGoalParticles(particles: GoalParticle[], deltaMs: number): void
{
  const dt = deltaMs / 1000;

  for (let i = particles.length - 1; i >= 0; i--)
  {
    const p = particles[i];

    /* Apply gravity (increases vy downward each frame). */
    p.vy  += GOAL_PARTICLE_GRAVITY * dt;

    /* Integrate velocity into position. */
    p.x   += p.vx * dt;
    p.y   += p.vy * dt;

    /* Advance age and remove if expired. */
    p.age += deltaMs;
    if (p.age >= GOAL_PARTICLE_MS) particles.splice(i, 1);
  }
}
