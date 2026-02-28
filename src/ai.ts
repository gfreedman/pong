// AIController — drives Player 2 paddle with a predict-then-track loop.
// Three difficulty tiers with meaningfully different behaviour:
//   EASY   — only tracks where the ball IS right now (no prediction), slow, inaccurate
//   MEDIUM — predicts ball trajectory (ballistic, ignores spin), current feel
//   HARD   — predicts trajectory including spin curves, fast, nearly precise

import { Paddle, Ball, Difficulty } from './types.js';
import {
  CANVAS_HEIGHT,
  PADDLE_BASE_SPEED,
  PADDLE_ACCEL, PADDLE_DECEL_FAST, PADDLE_DECEL_SLOW, PADDLE_DECEL_CURVE,
  AI_SPEED_FACTOR, AI_REACTION_DELAY_MIN, AI_REACTION_DELAY_MAX, AI_TARGET_OFFSET_MAX,
  AI_EASY_SPEED_FACTOR, AI_EASY_REACTION_DELAY_MIN, AI_EASY_REACTION_DELAY_MAX, AI_EASY_TARGET_OFFSET_MAX,
  AI_HARD_SPEED_FACTOR, AI_HARD_REACTION_DELAY_MIN, AI_HARD_REACTION_DELAY_MAX, AI_HARD_TARGET_OFFSET_MAX,
  SPIN_CURVE_FORCE, SPIN_DECAY_PER_S,
} from './constants.js';

type PredictionMode = 'none' | 'ballistic' | 'spin';

interface DifficultyConfig {
  speedFactor: number;
  reactionDelayMin: number;
  reactionDelayMax: number;
  targetOffsetMax: number;
  predictionMode: PredictionMode;
}

const CONFIGS: Record<Difficulty, DifficultyConfig> = {
  EASY: {
    speedFactor:      AI_EASY_SPEED_FACTOR,
    reactionDelayMin: AI_EASY_REACTION_DELAY_MIN,
    reactionDelayMax: AI_EASY_REACTION_DELAY_MAX,
    targetOffsetMax:  AI_EASY_TARGET_OFFSET_MAX,
    predictionMode:   'none',      // just chases current ball position
  },
  MEDIUM: {
    speedFactor:      AI_SPEED_FACTOR,
    reactionDelayMin: AI_REACTION_DELAY_MIN,
    reactionDelayMax: AI_REACTION_DELAY_MAX,
    targetOffsetMax:  AI_TARGET_OFFSET_MAX,
    predictionMode:   'ballistic', // simulates trajectory, ignores spin
  },
  HARD: {
    speedFactor:      AI_HARD_SPEED_FACTOR,
    reactionDelayMin: AI_HARD_REACTION_DELAY_MIN,
    reactionDelayMax: AI_HARD_REACTION_DELAY_MAX,
    targetOffsetMax:  AI_HARD_TARGET_OFFSET_MAX,
    predictionMode:   'spin',      // full trajectory + spin simulation
  },
};

export class AIController {
  private targetY: number = CANVAS_HEIGHT / 2;
  private decisionTimer: number = 0;
  private config: DifficultyConfig = CONFIGS.MEDIUM;

  /** Call before the match starts to configure difficulty. */
  configure(difficulty: Difficulty): void {
    this.config = CONFIGS[difficulty];
    this.reset();
  }

  /**
   * Update AI paddle toward the ball each frame.
   * Call this instead of player input for P2.
   */
  update(paddle: Paddle, ball: Ball, deltaMs: number): void {
    // Recalculate target on a randomized timer to simulate reaction delay
    this.decisionTimer -= deltaMs;
    if (this.decisionTimer <= 0) {
      const { reactionDelayMin, reactionDelayMax, targetOffsetMax, predictionMode } = this.config;
      this.decisionTimer = reactionDelayMin + Math.random() * (reactionDelayMax - reactionDelayMin);

      let predictedY: number;
      if (predictionMode === 'none') {
        // Easy: just track the ball's current Y — AI arrives where ball WAS, not where it IS
        predictedY = ball.vx > 0 ? ball.y : CANVAS_HEIGHT / 2;
      } else {
        predictedY = this.predictBallY(ball, paddle.x, predictionMode === 'spin');
      }

      const error = (Math.random() - 0.5) * 2 * targetOffsetMax;
      // Target top edge of paddle, clamped to screen
      this.targetY = Math.max(0,
        Math.min(CANVAS_HEIGHT - paddle.height, predictedY - paddle.height / 2 + error));
    }

    const dt = deltaMs / 1000;
    const maxSpeed = PADDLE_BASE_SPEED * this.config.speedFactor;
    const diff = this.targetY - paddle.y;

    paddle.prevY = paddle.y;

    if (Math.abs(diff) > 2) {
      const dir = diff > 0 ? 1 : -1;
      paddle.vy = Math.max(-maxSpeed, Math.min(maxSpeed, paddle.vy + dir * PADDLE_ACCEL));
    } else {
      // Decelerate using the same curve as the player paddle
      const speedNorm = Math.abs(paddle.vy) / maxSpeed;
      const t = Math.pow(speedNorm, PADDLE_DECEL_CURVE);
      paddle.vy *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t;
      if (Math.abs(paddle.vy) < 1) paddle.vy = 0;
    }

    paddle.y += paddle.vy * dt;
    paddle.y = Math.max(0, Math.min(CANVAS_HEIGHT - paddle.height, paddle.y));
  }

  /**
   * Predict where the ball will reach targetX.
   * @param withSpin  true = Hard mode: also simulates spin's curve effect on vy
   */
  private predictBallY(ball: Ball, targetX: number, withSpin: boolean): number {
    if (ball.vx <= 0) return CANVAS_HEIGHT / 2; // ball moving away → return to centre

    let x = ball.x;
    let y = ball.y;
    let vy = ball.vy;
    const vx = ball.vx;
    const r = ball.radius;
    const step = 1 / 60;
    let spin = withSpin ? ball.spin : 0;

    for (let i = 0; i < 400 && x < targetX; i++) {
      if (withSpin) {
        vy += SPIN_CURVE_FORCE * spin * step;
        spin *= 1 - SPIN_DECAY_PER_S * step;
      }
      x += vx * step;
      y += vy * step;

      if (y - r < 0) {
        y = r;
        vy = Math.abs(vy);
      } else if (y + r > CANVAS_HEIGHT) {
        y = CANVAS_HEIGHT - r;
        vy = -Math.abs(vy);
      }
    }

    return y;
  }

  /** Reset AI state between matches (called by configure() too). */
  reset(): void {
    this.targetY = CANVAS_HEIGHT / 2;
    this.decisionTimer = 0;
  }
}
