// AIController — drives Player 2 paddle with a predict-then-track loop

import { Paddle, Ball } from './types.js';
import {
  CANVAS_HEIGHT,
  PADDLE_BASE_SPEED,
  PADDLE_ACCEL, PADDLE_DECEL_FAST, PADDLE_DECEL_SLOW, PADDLE_DECEL_CURVE,
  AI_SPEED_FACTOR, AI_REACTION_DELAY_MIN, AI_REACTION_DELAY_MAX, AI_TARGET_OFFSET_MAX,
} from './constants.js';

export class AIController {
  private targetY: number = CANVAS_HEIGHT / 2;
  private decisionTimer: number = 0;

  /**
   * Update AI paddle toward the ball each frame.
   * Call this instead of player input for P2.
   */
  update(paddle: Paddle, ball: Ball, deltaMs: number): void {
    // Recalculate target on a randomized delay to fake reaction time
    this.decisionTimer -= deltaMs;
    if (this.decisionTimer <= 0) {
      const delay = AI_REACTION_DELAY_MIN +
        Math.random() * (AI_REACTION_DELAY_MAX - AI_REACTION_DELAY_MIN);
      this.decisionTimer = delay;

      const predictedY = this.predictBallY(ball, paddle.x);
      const error = (Math.random() - 0.5) * 2 * AI_TARGET_OFFSET_MAX;
      // targetY is the top edge of the paddle; clamp so paddle stays on screen
      this.targetY = Math.max(0,
        Math.min(CANVAS_HEIGHT - paddle.height, predictedY - paddle.height / 2 + error));
    }

    const dt = deltaMs / 1000;
    const maxSpeed = PADDLE_BASE_SPEED * AI_SPEED_FACTOR;
    const diff = this.targetY - paddle.y;

    paddle.prevY = paddle.y;

    if (Math.abs(diff) > 2) {
      const dir = diff > 0 ? 1 : -1;
      paddle.vy = Math.max(-maxSpeed, Math.min(maxSpeed, paddle.vy + dir * PADDLE_ACCEL));
    } else {
      // Decelerate with same curve as player
      const speedNorm = Math.abs(paddle.vy) / maxSpeed;
      const t = Math.pow(speedNorm, PADDLE_DECEL_CURVE);
      paddle.vy *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t;
      if (Math.abs(paddle.vy) < 1) paddle.vy = 0;
    }

    paddle.y += paddle.vy * dt;
    paddle.y = Math.max(0, Math.min(CANVAS_HEIGHT - paddle.height, paddle.y));
  }

  /**
   * Predict where the ball will be (y) when it reaches targetX.
   * Simulates bounces off top/bottom walls. Ignores spin for simplicity.
   * Returns midpoint if ball is moving away from the AI side.
   */
  private predictBallY(ball: Ball, targetX: number): number {
    if (ball.vx <= 0) return CANVAS_HEIGHT / 2;

    let x = ball.x;
    let y = ball.y;
    let vy = ball.vy;
    const vx = ball.vx;
    const r = ball.radius;
    const step = 1 / 60; // simulate at 60fps resolution

    for (let i = 0; i < 300 && x < targetX; i++) {
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

  /** Reset AI state for a fresh match. */
  reset(): void {
    this.targetY = CANVAS_HEIGHT / 2;
    this.decisionTimer = 0;
  }
}
