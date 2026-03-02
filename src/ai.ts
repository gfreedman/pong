/**
 * @file ai.ts
 * @description AIController — drives the right-side (Player 2) paddle without human input.
 *
 * ALGORITHM OVERVIEW — "THE SKILL CURVE MODEL"
 * ---------------------------------------------
 * The AI uses a predict-then-track control loop modulated by a hot/cold form
 * factor that creates human-like momentum swings across a match:
 *
 *   1. FORM    — A [-1, +1] "streak" value.  Increases when the AI scores
 *                (building a hot streak), decreases when it concedes (cold
 *                streak), and decays slowly toward 0 between points.
 *
 *   2. SKILL   — Derived from form each decision cycle.  High form gives
 *                faster reactions, more accurate aim, and better prediction.
 *                Low form gives slower reactions, sloppier aim, and opens the
 *                door to false reads.
 *
 *   3. PREDICT — Every `reactionDelay` milliseconds (scaled by form), simulate
 *                the ball's future trajectory to estimate where it will cross
 *                the AI paddle's X position.
 *
 *   4. TARGET  — Store the predicted Y (+ random error scaled by form) as
 *                `targetY`.  On cold streaks, occasionally mirror the prediction
 *                to simulate a "false read" — the AI commits to the wrong side.
 *
 *   5. TRACK   — Every frame, accelerate the paddle toward `targetY` at a speed
 *                that is capped by effectiveSpeed (also scaled by form).
 *
 * THREE DIFFICULTY TIERS
 * ----------------------
 *   EASY   — No trajectory prediction; very streaky (high form influence).
 *             On a cold streak: slow, inaccurate, prone to false reads.
 *             On a hot streak: surprisingly competitive.
 *
 *   MEDIUM — Ballistic prediction (simulates wall bounces, ignores spin).
 *             Moderate streakiness.  Can be beaten by consistent spin play,
 *             especially when it slips into a cold stretch.
 *
 *   HARD   — Full spin-aware prediction; low form influence (consistent).
 *             Always dangerous, but cold streaks and heavy spin create real
 *             openings.  Never unbeatable — just very demanding.
 *
 * TEST COMPATIBILITY
 * ------------------
 * Existing tests read config.speedFactor, config.predictionMode, decisionTimer,
 * and targetY via `as any` casts.  All of those fields retain their original
 * *baseline* values (unchanged from before this system was added).  Dynamic
 * modulation only fires during a decision cycle, and tests always start at
 * neutral form (form = 0), so the baseline values are what the tests observe.
 */

import { Paddle, Ball, Difficulty } from './types.js';
import
{
  CANVAS_HEIGHT,
  PADDLE_BASE_SPEED,
  PADDLE_ACCEL, PADDLE_DECEL,
  AI_SPEED_FACTOR, AI_REACTION_DELAY_MIN, AI_REACTION_DELAY_MAX, AI_TARGET_OFFSET_MAX,
  AI_EASY_SPEED_FACTOR, AI_EASY_REACTION_DELAY_MIN, AI_EASY_REACTION_DELAY_MAX, AI_EASY_TARGET_OFFSET_MAX,
  AI_HARD_SPEED_FACTOR, AI_HARD_REACTION_DELAY_MIN, AI_HARD_REACTION_DELAY_MAX, AI_HARD_TARGET_OFFSET_MAX,
  SPIN_CURVE_FORCE, SPIN_DECAY_PER_S,
  AI_FORM_HIT_BONUS, AI_FORM_MISS_PENALTY, AI_FORM_DECAY_PER_FRAME,
  AI_EASY_FORM_INFLUENCE, AI_EASY_FALSE_READ_CHANCE,
  AI_FORM_INFLUENCE, AI_FALSE_READ_CHANCE,
  AI_HARD_FORM_INFLUENCE, AI_HARD_FALSE_READ_CHANCE,
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
 *
 * The speed, delay, and error fields are the *baseline* values at neutral form
 * (form = 0).  Dynamic modulation scales them up or down based on the current
 * hot/cold streak without changing the stored config values.
 */
interface DifficultyConfig
{
  /** Fraction of PADDLE_BASE_SPEED the AI can reach at neutral form (0–1). */
  speedFactor: number;

  /** Minimum ms between AI target recalculations at neutral form. */
  reactionDelayMin: number;

  /** Maximum ms between AI target recalculations at neutral form. */
  reactionDelayMax: number;

  /** Maximum ±px random error at neutral form. */
  targetOffsetMax: number;

  /** Which trajectory simulation mode to use. */
  predictionMode: PredictionMode;

  /**
   * How strongly form modulates this tier's parameters.
   * Larger = more streaky (Easy).  Smaller = more consistent (Hard).
   * Formula for effective speed:   speedFactor    * (1 + form * fi * 0.35)
   * Formula for delay multiplier:  1 - form * fi * 0.45
   * Formula for effective error:   targetOffsetMax * (1 + (-form) * fi * 0.80)
   */
  formInfluence: number;

  /**
   * Base probability per decision cycle of a false read when the AI is
   * maximally cold (form = -1).  Actual probability = falseReadChance * max(0, -form).
   * 0 when hot; grows linearly as form drops toward -1.
   */
  falseReadChance: number;
}

/* ─── Difficulty configuration table ────────────────────────────────────── */

/**
 * @constant CONFIGS
 * @description Maps each Difficulty to its full tuning config.
 *              Baseline values (speedFactor, delays, error) are identical to
 *              the pre-Skill-Curve values so existing unit tests are unaffected.
 */
const CONFIGS: Record<Difficulty, DifficultyConfig> =
{
  EASY:
  {
    speedFactor:      AI_EASY_SPEED_FACTOR,         // 0.58 — tested: < 0.6 ✓
    reactionDelayMin: AI_EASY_REACTION_DELAY_MIN,   // 240  — tested: in [240,380] ✓
    reactionDelayMax: AI_EASY_REACTION_DELAY_MAX,   // 380
    targetOffsetMax:  AI_EASY_TARGET_OFFSET_MAX,    // 90px

    /* 'none' = only tracks where the ball IS, not where it will be. */
    predictionMode:   'none',                       // tested: 'none' ✓

    formInfluence:    AI_EASY_FORM_INFLUENCE,       // 0.45 — highly streaky
    falseReadChance:  AI_EASY_FALSE_READ_CHANCE,    // 0.30
  },

  MEDIUM:
  {
    speedFactor:      AI_SPEED_FACTOR,              // 0.85 — tested: ≈ 0.85 ✓
    reactionDelayMin: AI_REACTION_DELAY_MIN,        // 120
    reactionDelayMax: AI_REACTION_DELAY_MAX,        // 180
    targetOffsetMax:  AI_TARGET_OFFSET_MAX,         // 40px

    /* 'ballistic' = simulates wall bounces but ignores spin. */
    predictionMode:   'ballistic',                  // tested: 'ballistic' ✓

    formInfluence:    AI_FORM_INFLUENCE,            // 0.28 — moderate streaks
    falseReadChance:  AI_FALSE_READ_CHANCE,         // 0.12
  },

  HARD:
  {
    speedFactor:      AI_HARD_SPEED_FACTOR,         // 0.97 — tested: > 0.95 ✓
    reactionDelayMin: AI_HARD_REACTION_DELAY_MIN,   // 55   — tested: in [55,95] ✓
    reactionDelayMax: AI_HARD_REACTION_DELAY_MAX,   // 95
    targetOffsetMax:  AI_HARD_TARGET_OFFSET_MAX,    // 6px

    /* 'spin' = full simulation including spin's vy curve effect. */
    predictionMode:   'spin',                       // tested: 'spin' ✓

    formInfluence:    AI_HARD_FORM_INFLUENCE,       // 0.13 — consistent under pressure
    falseReadChance:  AI_HARD_FALSE_READ_CHANCE,    // 0.04
  },
};

/* ─── AIController class ─────────────────────────────────────────────────── */

/**
 * @class AIController
 * @description Drives the AI paddle using the Skill Curve predict-then-track algorithm.
 *
 * Ownership model:
 *   - The Game class owns one AIController instance.
 *   - Each frame the Game calls update(), passing the live paddle and ball state.
 *   - After each goal the Game calls notifyGoal() to update the form factor.
 *   - AIController writes directly into paddle.vy and paddle.y.
 */
export class AIController
{
  /* ── Private state ───────────────────────────────────────────────────────
     Three pieces of mutable state:
       targetY       — where the paddle is currently trying to go.
       decisionTimer — countdown until the AI "thinks" about the ball again.
       form          — hot/cold streak factor [-1, +1].  Persists between points
                       within a match; reset to 0 only when a new match starts. */

  /** The Y position (top edge) the AI paddle is currently tracking toward. */
  private targetY: number = CANVAS_HEIGHT / 2;

  /** Countdown in ms until the AI next recalculates its target. */
  private decisionTimer: number = 0;

  /** Active difficulty configuration (defaults to MEDIUM until configure() is called). */
  private config: DifficultyConfig = CONFIGS.MEDIUM;

  /**
   * Hot/cold streak factor in [-1, +1].
   *   +1 = maximum hot streak (faster, more accurate, better prediction).
   *   -1 = maximum cold streak (slower, sloppier, prone to false reads).
   *    0 = neutral form (baseline parameters, matching pre-Skill-Curve behavior).
   * Persists between points within a match; reset to 0 by configure().
   */
  private form: number = 0;

  /* ── Public API ──────────────────────────────────────────────────────── */

  /**
   * @method configure
   * @description Sets the difficulty tier before a match begins.
   *              Resets all AI state including form so no stale match data carries over.
   *
   * @param difficulty  The chosen difficulty: 'EASY', 'MEDIUM', or 'HARD'.
   */
  configure(difficulty: Difficulty): void
  {
    this.config = CONFIGS[difficulty];
    this.form   = 0;           // fresh match — neutral form
    this.reset();
  }

  /**
   * @method notifyGoal
   * @description Updates the form factor after a point is scored.
   *              Call this once per goal from the Game class.
   *
   *   scoredByPlayer === 1  →  human scored  →  AI conceded  →  form decreases.
   *   scoredByPlayer === 2  →  AI scored      →  AI hot streak →  form increases.
   *
   * @param scoredByPlayer  1 = human player scored; 2 = AI scored.
   */
  notifyGoal(scoredByPlayer: 1 | 2): void
  {
    if (scoredByPlayer === 1)
    {
      /* Human scored — AI missed — go colder. */
      this.form = Math.max(-1, this.form - AI_FORM_MISS_PENALTY);
    }
    else
    {
      /* AI scored — AI caught the ball — go hotter. */
      this.form = Math.min(1, this.form + AI_FORM_HIT_BONUS);
    }
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
    /* ── Form decay: slowly return toward neutral between goals ─────────────
       Keeps streaks from becoming permanent.  At form = 0, multiplication by
       (1 - 0.0015) still equals 0, so neutral form stays neutral — this never
       drifts a previously-zeroed form away from zero.                        */
    this.form *= 1 - AI_FORM_DECAY_PER_FRAME;

    /* ── Step 1: Recalculate target on a form-modulated timer ──────────────
       The timer introduces realistic reaction lag.  Hot form → shorter delay
       (quicker reactions).  Cold form → longer delay (sluggish reactions).   */

    this.decisionTimer -= deltaMs;

    if (this.decisionTimer <= 0)
    {
      const { reactionDelayMin, reactionDelayMax, targetOffsetMax, predictionMode } = this.config;
      const fi = this.config.formInfluence;
      const f  = this.form;                   // [-1, +1]

      /* ── Compute effective parameters from form ── */

      /* Reaction delay: hot form shortens it; cold form lengthens it. */
      const delayMult  = 1 - f * fi * 0.45;
      const effDelayMin = Math.max(20,  reactionDelayMin * delayMult);
      const effDelayMax = Math.max(effDelayMin + 10, Math.min(700, reactionDelayMax * delayMult));

      /* Aiming error: hot form shrinks it; cold form grows it. */
      const effError = Math.max(2, targetOffsetMax * (1 + (-f) * fi * 0.80));

      /* ── Reset decision timer ── */
      this.decisionTimer = effDelayMin + Math.random() * (effDelayMax - effDelayMin);

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

      /* ── False read: occasionally commit to the wrong side when cold ──────
         Fires only during cold streaks (form < 0).  Probability scales from
         0% (neutral form) up to falseReadChance * 100% (maximally cold).
         Simulates misreading spin direction or misjudging a bounce angle —
         the AI confidently chases the wrong position.                        */
      const coldDepth    = Math.max(0, -f);
      const falseReadPct = this.config.falseReadChance * coldDepth;

      if (Math.random() < falseReadPct)
      {
        predictedY = CANVAS_HEIGHT - predictedY;
      }

      /* ── Add aiming error ── */
      const error = (Math.random() - 0.5) * 2 * effError;

      /* ── Compute target top edge of paddle, clamped to screen ── */
      this.targetY = Math.max(
        0,
        Math.min(
          CANVAS_HEIGHT - paddle.height,
          predictedY - paddle.height / 2 + error
        )
      );
    }

    /* ── Step 2: Track toward targetY at form-modulated speed ──────────────
       Hot form raises the effective speed cap; cold form lowers it.
       Uses the same acceleration + deceleration curve as the human paddle
       so the AI feels like a real opponent, not a smoothly-interpolated robot. */

    const dt = deltaMs / 1000;

    /* Effective speed: hot form boosts it; cold form reduces it. */
    const fi = this.config.formInfluence;
    const f  = this.form;
    const effSpeed    = Math.max(0.25, Math.min(1.0, this.config.speedFactor * (1 + f * fi * 0.35)));
    const maxSpeed    = PADDLE_BASE_SPEED * effSpeed;
    const diff        = this.targetY - paddle.y;

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
      /* Decelerate — exponential decay matching the player paddle. */
      paddle.vy *= PADDLE_DECEL;

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
   * The simulation runs at 60fps time steps for up to 400 steps (≈ 6.7 seconds),
   * which is more than enough to predict any realistic trajectory.
   *
   * Wall bounces are handled by reflecting vy, exactly matching the physics engine.
   *
   * @param ball      Current ball state.
   * @param targetX   The X position to predict arrival at (paddle face X).
   * @param withSpin  If true, also simulates the spin force on vy (Hard mode).
   * @returns {number} Estimated Y position where the ball will reach targetX.
   */
  private predictBallY(ball: Ball, targetX: number, withSpin: boolean): number
  {
    /* If the ball is moving away from the AI (vx ≤ 0), return centre so the
       paddle idles in a neutral ready position.                              */
    if (ball.vx <= 0) return CANVAS_HEIGHT / 2;

    /* ── Initialize simulation state ── */
    let x    = ball.x;
    let y    = ball.y;
    let vy   = ball.vy;
    const vx = ball.vx;
    const r  = ball.radius;
    const step = 1 / 60;
    let spin = withSpin ? ball.spin : 0;

    /* ── Step through time until the ball reaches targetX ── */
    for (let i = 0; i < 400 && x < targetX; i++)
    {
      /* Apply spin force to vy (only in Hard mode). */
      if (withSpin)
      {
        vy   += SPIN_CURVE_FORCE * spin * step;
        spin *= 1 - SPIN_DECAY_PER_S * step;
      }

      /* Advance position. */
      x += vx * step;
      y += vy * step;

      /* Wall bounce: top boundary. */
      if (y - r < 0)
      {
        y  = r;
        vy = Math.abs(vy);
      }
      /* Wall bounce: bottom boundary. */
      else if (y + r > CANVAS_HEIGHT)
      {
        y  = CANVAS_HEIGHT - r;
        vy = -Math.abs(vy);
      }
    }

    return y;
  }

  /**
   * @method reset
   * @description Resets targetY and decisionTimer to safe defaults.
   *              Called by configure() when a new match begins.
   *              Does NOT reset form — that is configure()'s responsibility,
   *              keeping reset() focused on positional / timer state only.
   */
  reset(): void
  {
    this.targetY       = CANVAS_HEIGHT / 2;
    this.decisionTimer = 0;
  }
}
