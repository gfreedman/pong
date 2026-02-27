// Game — state machine, game loop, orchestration

import { Ball, Paddle, GameState, GamePhase, ImpactRing, WallMark, ScreenShake, GoalFlash, GoalParticle } from './types.js';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BALL_RADIUS, BALL_BASE_SPEED,
  PADDLE_WIDTH, PADDLE_HEIGHT, PADDLE_BASE_SPEED, PADDLE_MARGIN,
  PADDLE_ACCEL, PADDLE_DECEL_FAST, PADDLE_DECEL_SLOW, PADDLE_DECEL_CURVE,
  COLOR_P1, COLOR_P2,
  SHAKE_HIT_INTENSITY, SHAKE_HIT_MS,
  SHAKE_GOAL_INTENSITY, SHAKE_GOAL_MS,
  BALL_SAD_MS,
  SERVE_COUNTDOWN_MS,
} from './constants.js';
import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { Renderer } from './renderer.js';
import {
  updateBall, updatePaddleAnimations, resetBall,
  spawnImpactRing, updateImpactRings,
  spawnWallMark, updateWallMarks,
  updateScreenShake, triggerShake, getShakeOffset,
  triggerPaddleEmotion,
  spawnGoalFlash, updateGoalFlashes,
  spawnGoalParticles, updateGoalParticles,
} from './physics.js';

function makeBall(): Ball {
  return {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: BALL_BASE_SPEED,
    vy: 0,
    spin: 0,
    spinAngle: 0,
    radius: BALL_RADIUS,
    speed: BALL_BASE_SPEED,
    hitstopTimer: 0,
    squashTimer: 0,
    stretchTimer: 0,
    hitFlashTimer: 0,
    sadTimer: 0,
    trail: [],
    trailTimer: 0,
  };
}

function makePaddle(side: 1 | 2): Paddle {
  const x = side === 1
    ? PADDLE_MARGIN
    : CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH;
  return {
    x, y: (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2,
    baseX: x,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    vy: 0, prevY: (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2,
    recoilOffset: 0, recoilVelocity: 0,
    breathPhase: side === 2 ? Math.PI : 0, // offset so they don't breathe in sync
    chromaticTimer: 0,
    emotionOffset: 0, emotionVelocity: 0,
    id: side,
  };
}

function makeShake(): ScreenShake {
  return { intensity: 0, duration: 0, elapsed: 0 };
}

export class Game {
  private state: GameState;
  private input: InputManager;
  private audio: AudioManager;
  private renderer: Renderer;

  private lastTimestamp = 0;
  private rafId = 0;

  // Toy mode: phase 1, ball reflects off right wall
  private toyMode = true;

  // Spin discovery tracking
  private rallyHits = 0;
  private spinDiscoveryShown = false;
  private spinDiscoveryTimer = 0; // ms remaining to display label

  // Countdown state
  private countdownTimer = 0;
  private countdownStep = 3;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new InputManager();
    this.audio = new AudioManager();
    this.renderer = new Renderer(canvas);

    this.state = {
      phase: 'PLAYING',
      ball: makeBall(),
      player1: makePaddle(1),
      player2: makePaddle(2),
      score1: 0,
      score2: 0,
      impactRings: [],
      wallMarks: [],
      goalFlashes: [],
      goalParticles: [],
      shake: makeShake(),
      rallyCount: 0,
      longestRally: 0,
      isFirstLaunch: true,
    };

    // Launch ball toward player for first launch experience
    this.launchToyBall();
  }

  private launchToyBall(): void {
    resetBall(this.state.ball, false); // launch rightward (toward right wall) initially
    // Gentle initial speed for toy mode
    this.state.ball.speed = BALL_BASE_SPEED * 0.85;
    const speed = this.state.ball.speed;
    this.state.ball.vx = speed * 0.9;
    this.state.ball.vy = speed * (Math.random() > 0.5 ? 0.2 : -0.2);
  }

  start(): void {
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  // ─── Main Loop ─────────────────────────────────────────────────────────

  private loop(timestamp: number): void {
    const deltaMs = Math.min(timestamp - this.lastTimestamp, 80); // cap at 80ms
    this.lastTimestamp = timestamp;

    this.update(deltaMs);
    this.render();

    this.input.flush();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  // ─── Update ────────────────────────────────────────────────────────────

  private update(deltaMs: number): void {
    const { state } = this;

    this.handleInput(deltaMs);
    this.updatePaddleMovement(deltaMs);
    this.updateAnimations(deltaMs);

    if (state.phase === 'PLAYING') {
      this.updatePhysics(deltaMs);
    }

    updateImpactRings(state.impactRings, deltaMs);
    updateWallMarks(state.wallMarks, deltaMs);
    updateGoalFlashes(state.goalFlashes, deltaMs);
    updateGoalParticles(state.goalParticles, deltaMs);
    updateScreenShake(state.shake, deltaMs);
    this.audio.tick(deltaMs);

    // Spin discovery timer
    if (this.spinDiscoveryTimer > 0) {
      this.spinDiscoveryTimer = Math.max(0, this.spinDiscoveryTimer - deltaMs);
    }
  }

  private handleInput(_deltaMs: number): void {
    if (this.input.pause()) {
      // Phase 1: just for future expansion
    }
  }

  private updatePaddleMovement(deltaMs: number): void {
    const { state, input } = this;
    const dt = deltaMs / 1000;
    const p1 = state.player1;

    // Record previous Y for spin calculation
    p1.prevY = p1.y;

    // Smooth acceleration toward target velocity
    const p1Up = input.p1Up();
    const p1Down = input.p1Down();

    if (p1Up && !p1Down) {
      p1.vy = Math.max(p1.vy - PADDLE_ACCEL, -PADDLE_BASE_SPEED);
    } else if (p1Down && !p1Up) {
      p1.vy = Math.min(p1.vy + PADDLE_ACCEL, PADDLE_BASE_SPEED);
    } else {
      // Power-curved decel: spends longer near FAST (carrying speed), drops
      // through the middle, then drifts gently to zero — the Mario skid shape.
      const speedNorm = Math.abs(p1.vy) / PADDLE_BASE_SPEED;
      const t = Math.pow(speedNorm, PADDLE_DECEL_CURVE);
      p1.vy *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t;
      if (Math.abs(p1.vy) < 1) p1.vy = 0;
    }

    p1.y += p1.vy * dt;

    // Clamp to canvas
    p1.y = Math.max(0, Math.min(CANVAS_HEIGHT - p1.height, p1.y));

    // In toy mode, player2 is not controlled; skip its movement
    if (!this.toyMode) {
      const p2 = state.player2;
      p2.prevY = p2.y;
      const p2Up = input.p2Up();
      const p2Down = input.p2Down();
      if (p2Up && !p2Down) {
        p2.vy = Math.max(p2.vy - PADDLE_ACCEL, -PADDLE_BASE_SPEED);
      } else if (p2Down && !p2Up) {
        p2.vy = Math.min(p2.vy + PADDLE_ACCEL, PADDLE_BASE_SPEED);
      } else {
        const speedNorm2 = Math.abs(p2.vy) / PADDLE_BASE_SPEED;
        const t2 = Math.pow(speedNorm2, PADDLE_DECEL_CURVE);
        p2.vy *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t2;
        if (Math.abs(p2.vy) < 1) p2.vy = 0;
      }
      p2.y += p2.vy * dt;
      p2.y = Math.max(0, Math.min(CANVAS_HEIGHT - p2.height, p2.y));
    }
  }

  private updateAnimations(deltaMs: number): void {
    const { state } = this;
    updatePaddleAnimations(state.player1, deltaMs);
    updatePaddleAnimations(state.player2, deltaMs);
  }

  private updatePhysics(deltaMs: number): void {
    const { state } = this;

    const result = updateBall(
      state.ball,
      state.player1,
      state.player2,
      deltaMs,
      this.toyMode
    );

    // ── Handle paddle hit ─────────────────────────────────────────────
    if (result.hitPaddle !== null) {
      const hitPaddle = result.hitPaddle === 1 ? state.player1 : state.player2;
      const color = result.hitPaddle === 1 ? COLOR_P1 : COLOR_P2;

      // Spawn impact ring at ball position
      spawnImpactRing(state.impactRings, state.ball.x, state.ball.y, color);

      // Screen shake
      triggerShake(state.shake, SHAKE_HIT_INTENSITY, SHAKE_HIT_MS);

      // Audio — pitch-matched with edge factor
      const edgeFactor = (state.ball as Ball & { _edgeFactor?: number })._edgeFactor ?? 0;
      this.audio.playPaddleHit(state.ball.speed, edgeFactor);

      // Rally tracking
      this.rallyHits++;
      state.rallyCount++;

      // Spin discovery: show after 3 rally hits if paddle was moving
      if (!this.spinDiscoveryShown && this.rallyHits >= 3 && Math.abs(hitPaddle.vy) > 60) {
        this.spinDiscoveryShown = true;
        this.spinDiscoveryTimer = 1500;
        this.audio.playSpinDiscovery();
      }
    }

    // ── Handle wall bounce ────────────────────────────────────────────
    if (result.hitWall) {
      this.audio.playWallBounce();

      // Scorch mark at contact point
      if (result.hitWall === 'top') {
        spawnWallMark(state.wallMarks, state.ball.x, 0);
      } else if (result.hitWall === 'bottom') {
        spawnWallMark(state.wallMarks, state.ball.x, CANVAS_HEIGHT);
      } else if (result.hitWall === 'right') {
        spawnWallMark(state.wallMarks, CANVAS_WIDTH, state.ball.y);
      }
    }

    // ── Handle goal ───────────────────────────────────────────────────
    if (result.goal !== null) {
      triggerShake(state.shake, SHAKE_GOAL_INTENSITY, SHAKE_GOAL_MS);
      this.audio.playGoal();

      // Ball looks sad for 500ms
      state.ball.sadTimer = BALL_SAD_MS;

      if (result.goal === 1) {
        state.score1++;
        triggerPaddleEmotion(state.player1, true);   // p1 jumps (scored)
        triggerPaddleEmotion(state.player2, false);  // p2 sags (conceded)
        // Ball exited right wall: right half flashes, particles fan left, scored-on = P2 (magenta)
        spawnGoalFlash(state.goalFlashes, 1);
        spawnGoalParticles(state.goalParticles, CANVAS_WIDTH, state.ball.y, COLOR_P2, Math.PI);
      } else {
        state.score2++;
        triggerPaddleEmotion(state.player2, true);
        triggerPaddleEmotion(state.player1, false);
        // Ball exited left wall: left half flashes, particles fan right, scored-on = P1 (cyan)
        spawnGoalFlash(state.goalFlashes, 2);
        spawnGoalParticles(state.goalParticles, 0, state.ball.y, COLOR_P1, 0);
      }

      if (state.rallyCount > state.longestRally) {
        state.longestRally = state.rallyCount;
      }
      state.rallyCount = 0;
      this.rallyHits = 0;

      // In toy mode, ball is already reset by physics.ts (left-edge miss → reset)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  private render(): void {
    const { state } = this;
    const [shakeX, shakeY] = getShakeOffset(state.shake);

    if (this.toyMode) {
      this.renderer.drawToyMode(state, shakeX, shakeY);

      // Spin discovery overlay
      if (this.spinDiscoveryTimer > 0) {
        const alpha = Math.min(1, this.spinDiscoveryTimer / 400) *
                      Math.min(1, (1500 - (1500 - this.spinDiscoveryTimer)) / 300);
        this.renderer.drawSpinDiscovery(
          state.ball.x, state.ball.y,
          Math.min(1, this.spinDiscoveryTimer / 400)
        );
      }
    } else {
      this.renderer.draw(state, shakeX, shakeY);
    }
  }
}
