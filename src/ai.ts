/**
 * @file ai.ts
 * @description AIController — drives the right-side (Player 2) paddle without human input.
 *
 * ALGORITHM OVERVIEW
 * ------------------
 * The AI uses a "predict-then-track" control loop that runs on a randomized timer:
 *
 *   1. PREDICT  — Every `reactionDelay` milliseconds, simulate the ball's future
 *                 trajectory to find where it will reach the AI paddle's X position.
 *   2. TARGET   — Store that predicted Y (plus a random aiming error) as `targetY`.
 *   3. TRACK    — Every frame, accelerate the paddle toward `targetY` using the
 *                 same spring-like speed curve as the player's paddle.
 *
 * The randomized reaction delay (120–180ms for Medium) is what makes the AI feel
 * like a thinking opponent rather than a perfect robot — it sees the ball, but
 * only "reacts" after a realistic human-like delay.
 *
 * THREE DIFFICULTY TIERS
 * ----------------------
 *   EASY   — No prediction.  The AI chases where the ball IS right now, not where
 *             it will be.  This means it often arrives at the wrong spot.
 *             Slow paddle, long reaction delay, large aiming error.
 *
 *   MEDIUM — Ballistic prediction (simulates wall bounces, ignores spin).
 *             Moderate speed, reaction delay, and error.
 *
 *   HARD   — Full spin-aware prediction (simulates both wall bounces AND the
 *             spin curve effect on vy).  Fast, near-instant reactions, tiny error.
 */

import { Paddle, Ball, Difficulty } from './types.js';
import
{
  CANVAS_HEIGHT,
  PADDLE_BASE_SPEED,
  PADDLE_ACCEL, PADDLE_DECEL_FAST, PADDLE_DECEL_SLOW, PADDLE_DECEL_CURVE,
  AI_SPEED_FACTOR, AI_REACTION_DELAY_MIN, AI_REACTION_DELAY_MAX, AI_TARGET_OFFSET_MAX,
  AI_EASY_SPEED_FACTOR, AI_EASY_REACTION_DELAY_MIN, AI_EASY_REACTION_DELAY_MAX, AI_EASY_TARGET_OFFSET_MAX,
  AI_HARD_SPEED_FACTOR, AI_HARD_REACTION_DELAY_MIN, AI_HARD_REACTION_DELAY_MAX, AI_HARD_TARGET_OFFSET_MAX,
  SPIN_CURVE_FORCE, SPIN_DECAY_PER_S,
} from './constants.js';

/* ─── Internal types ─────────────────────────────────────────────────────── */

/**
 * @typedef PredictionMode
 * @description Controls how the AI simulates the ball's future trajectory.
 *   - 'none'      — No prediction; AI tracks current ball position.
 *   - 'ballistic' — Simulates wall bounces but ignores spin. (Medium)
 *   - 'spin'      — Simulates wall bounces AND spin curves. (Hard)
 */
type PredictionMode = 'none' | 'ballistic' | 'spin';

/**
 * @interface DifficultyConfig
 * @description All tuning parameters for one AI difficulty tier.
 */
interface DifficultyConfig
{
  /** Fraction of PADDLE_BASE_SPEED the AI can reach (0–1). */
  speedFactor: number;

  /** Minimum ms between AI target recalculations (reaction time floor). */
  reactionDelayMin: number;

  /** Maximum ms between AI target recalculations (reaction time ceiling). */
  reactionDelayMax: number;

  /** Maximum ±px random error added to the predicted target Y. */
  targetOffsetMax: number;

  /** Which trajectory simulation mode to use. */
  predictionMode: PredictionMode;
}

/* ─── Difficulty configuration table ────────────────────────────────────── */

/**
 * @constant CONFIGS
 * @description Maps each Difficulty enum value to its full tuning config.
 *              Centralizing configs here makes it easy to compare tiers
 *              and add new ones without touching the AIController logic.
 */
const CONFIGS: Record<Difficulty, DifficultyConfig> =
{
  EASY:
  {
    speedFactor:      AI_EASY_SPEED_FACTOR,
    reactionDelayMin: AI_EASY_REACTION_DELAY_MIN,
    reactionDelayMax: AI_EASY_REACTION_DELAY_MAX,
    targetOffsetMax:  AI_EASY_TARGET_OFFSET_MAX,

    /* 'none' = only tracks where the ball IS, not where it will be.
       The AI often arrives at the wrong spot because the ball moved
       while the AI was still "thinking".                            */
    predictionMode:   'none',
  },

  MEDIUM:
  {
    speedFactor:      AI_SPEED_FACTOR,
    reactionDelayMin: AI_REACTION_DELAY_MIN,
    reactionDelayMax: AI_REACTION_DELAY_MAX,
    targetOffsetMax:  AI_TARGET_OFFSET_MAX,

    /* 'ballistic' = simulates wall bounces but ignores spin.
       Good enough to return straight shots; spin can still fool it. */
    predictionMode:   'ballistic',
  },

  HARD:
  {
    speedFactor:      AI_HARD_SPEED_FACTOR,
    reactionDelayMin: AI_HARD_REACTION_DELAY_MIN,
    reactionDelayMax: AI_HARD_REACTION_DELAY_MAX,
    targetOffsetMax:  AI_HARD_TARGET_OFFSET_MAX,

    /* 'spin' = full simulation including spin's vy curve effect.
       Counters almost every shot; feel more like a machine.         */
    predictionMode:   'spin',
  },
};

/* ─── AIController class ─────────────────────────────────────────────────── */

/**
 * @class AIController
 * @description Drives the AI paddle using a predict-then-track algorithm.
 *
 * Ownership model:
 *   - The Game class owns one AIController instance.
 *   - Each frame the Game calls update(), passing the live paddle and ball state.
 *   - AIController writes directly into paddle.vy and paddle.y (it IS the player input).
 */
export class AIController
{
  /* ── Private state ───────────────────────────────────────────────────────
     Only two pieces of mutable state: the current target Y and a countdown
     timer that controls how often the AI "looks" at the ball.              */

  /** The Y position the AI paddle is currently tracking toward. */
  private targetY: number = CANVAS_HEIGHT / 2;

  /** Countdown in ms until the AI next recalculates its target. */
  private decisionTimer: number = 0;

  /** Active difficulty configuration (defaults to MEDIUM until configure() is called). */
  private config: DifficultyConfig = CONFIGS.MEDIUM;

  /* ── Public API ──────────────────────────────────────────────────────── */

  /**
   * @method configure
   * @description Sets the difficulty tier before a match begins.
   *              Also resets AI state so there is no stale target from the
   *              previous match.
   *
   * @param difficulty  The chosen difficulty: 'EASY', 'MEDIUM', or 'HARD'.
   */
  configure(difficulty: Difficulty): void
  {
    this.config = CONFIGS[difficulty];
    this.reset();
  }

  /**
   * @method update
   * @description Drives the AI paddle for one game frame.
   *
   * This method replaces what InputManager does for the human player.
   * It directly mutates paddle.vy and paddle.y so the physics and renderer
   * see the paddle moving just like the human's paddle would.
   *
   * Call ONCE per frame during PLAYING phase.
   *
   * @param paddle   The AI paddle (player2) — mutated in place.
   * @param ball     Current ball state — read only for prediction.
   * @param deltaMs  Time elapsed since last frame (milliseconds).
   */
  update(paddle: Paddle, ball: Ball, deltaMs: number): void
  {
    /* ── Step 1: Recalculate target on a randomized timer ──────────────────
       The timer introduces a realistic reaction lag so the AI doesn't
       instantly snap to a perfect intercept.  When the timer expires:
         - Predict where the ball will be when it reaches the paddle's X.
         - Add a random aiming error.
         - Store the result as targetY.
       Then reset the timer to a new random value in [min, max].           */

    this.decisionTimer -= deltaMs;

    if (this.decisionTimer <= 0)
    {
      const { reactionDelayMin, reactionDelayMax, targetOffsetMax, predictionMode } = this.config;

      /* Randomize the next recalculation window. */
      this.decisionTimer =
        reactionDelayMin + Math.random() * (reactionDelayMax - reactionDelayMin);

      /* ── Predict ball arrival Y ── */
      let predictedY: number;

      if (predictionMode === 'none')
      {
        /* Easy AI: just look at the ball's current Y.
           Only track it if the ball is coming toward us (vx > 0).
           Otherwise drift back toward centre — simulates "idle" behavior. */
        predictedY = ball.vx > 0 ? ball.y : CANVAS_HEIGHT / 2;
      }
      else
      {
        /* Medium / Hard: run the trajectory simulation. */
        predictedY = this.predictBallY(ball, paddle.x, predictionMode === 'spin');
      }

      /* ── Add aiming error ── */
      /* Random error in [-targetOffsetMax, +targetOffsetMax].
         Larger error = AI misses more (Easy).  Smaller = near-perfect (Hard). */
      const error = (Math.random() - 0.5) * 2 * targetOffsetMax;

      /* ── Compute target top edge of paddle, clamped to screen ── */
      /* We aim the CENTER of the paddle at predictedY, so subtract half height.
         Clamp so the paddle can't leave the court.                           */
      this.targetY = Math.max(
        0,
        Math.min(
          CANVAS_HEIGHT - paddle.height,
          predictedY - paddle.height / 2 + error
        )
      );
    }

    /* ── Step 2: Track toward targetY each frame ───────────────────────────
       Uses the same acceleration + deceleration curve as the human paddle
       so the AI paddle "feels" like the player's paddle, just AI-controlled.

       diff = how far we still need to travel.  Positive = need to move down.
       If |diff| > 2px → accelerate toward target.
       If |diff| ≤ 2px → we're close enough; use the decel curve to stop.  */

    const dt      = deltaMs / 1000;                          // convert ms → seconds
    const maxSpeed = PADDLE_BASE_SPEED * this.config.speedFactor;
    const diff    = this.targetY - paddle.y;

    /* Record previous Y for spin-impartment calculation in physics. */
    paddle.prevY = paddle.y;

    if (Math.abs(diff) > 2)
    {
      /* Accelerate in the direction of the target, capped at maxSpeed. */
      const dir = diff > 0 ? 1 : -1;
      paddle.vy = Math.max(-maxSpeed, Math.min(maxSpeed, paddle.vy + dir * PADDLE_ACCEL));
    }
    else
    {
      /* Decelerate using the same power-curve as the player paddle.
         speedNorm = current speed as a fraction of max speed (0–1).
         t         = power-curve weight (spends more time near FAST end).
         decel     = blend of DECEL_FAST (at speed) and DECEL_SLOW (near stop). */
      const speedNorm = Math.abs(paddle.vy) / maxSpeed;
      const t         = Math.pow(speedNorm, PADDLE_DECEL_CURVE);
      paddle.vy      *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t;

      /* Snap to zero to avoid micro-oscillation at very low velocities. */
      if (Math.abs(paddle.vy) < 1) paddle.vy = 0;
    }

    /* Integrate velocity into position, then clamp to canvas bounds. */
    paddle.y += paddle.vy * dt;
    paddle.y  = Math.max(0, Math.min(CANVAS_HEIGHT - paddle.height, paddle.y));
  }

  /* ── Private helpers ─────────────────────────────────────────────────── */

  /**
   * @method predictBallY
   * @description Simulates the ball's trajectory step-by-step to estimate
   *              where it will cross a given X position (the AI paddle's face).
   *
   * The simulation runs at 60fps time steps.  It simulates up to 400 steps
   * (≈ 6.7 seconds of game time) which is more than enough to predict any
   * realistic trajectory.
   *
   * Wall bounces are handled by reflecting vy when the ball would exit the
   * top or bottom boundary, exactly matching the actual physics engine.
   *
   * @param ball      Current ball state.
   * @param targetX   The X position to predict arrival at (paddle face X).
   * @param withSpin  If true, also simulates the spin force on vy (Hard mode).
   * @returns {number} Estimated Y position where the ball will reach targetX.
   */
  private predictBallY(ball: Ball, targetX: number, withSpin: boolean): number
  {
    /* If the ball is moving away from the AI (vx ≤ 0), there is no useful
       prediction to make.  Return centre so the paddle idles in a neutral
       position waiting for the ball to come back.                          */
    if (ball.vx <= 0) return CANVAS_HEIGHT / 2;

    /* ── Initialize simulation state ── */
    let x    = ball.x;
    let y    = ball.y;
    let vy   = ball.vy;
    const vx = ball.vx;                         // vx is constant (no friction)
    const r  = ball.radius;
    const step = 1 / 60;                        // one frame at 60fps (seconds)
    let spin = withSpin ? ball.spin : 0;        // start with actual spin if Hard

    /* ── Step through time until the ball reaches targetX ── */
    for (let i = 0; i < 400 && x < targetX; i++)
    {
      /* Apply spin force to vy (only in Hard mode). */
      if (withSpin)
      {
        vy   += SPIN_CURVE_FORCE * spin * step;
        spin *= 1 - SPIN_DECAY_PER_S * step;    // exponential spin decay
      }

      /* Advance position by one step. */
      x += vx * step;
      y += vy * step;

      /* Wall bounce: top boundary. */
      if (y - r < 0)
      {
        y  = r;
        vy = Math.abs(vy);                      // reflect downward
      }
      /* Wall bounce: bottom boundary. */
      else if (y + r > CANVAS_HEIGHT)
      {
        y  = CANVAS_HEIGHT - r;
        vy = -Math.abs(vy);                     // reflect upward
      }
    }

    return y;
  }

  /**
   * @method reset
   * @description Resets AI state to safe defaults.
   *              Called by configure() when a new match begins, and can be
   *              called directly to clear state mid-match if needed.
   */
  reset(): void
  {
    /* Start in the middle of the court — neutral ready position. */
    this.targetY       = CANVAS_HEIGHT / 2;

    /* 0 forces an immediate recalculation on the first update() call. */
    this.decisionTimer = 0;
  }
}
