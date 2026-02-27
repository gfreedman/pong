// Game — state machine, game loop, orchestration

import { Ball, Paddle, GameState, ImpactRing, WallMark, ScreenShake, GoalFlash, GoalParticle } from './types.js';
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
  MATCH_TARGET, SPARKS_PER_POINT, SPARKS_MATCH_WIN,
  RALLY_TIER_BUILDING, RALLY_TIER_INTENSE, RALLY_TIER_DRAMATIC, RALLY_TIER_LEGENDARY,
  EXHALE_BASE_MS, EXHALE_PER_RALLY_HIT, EXHALE_EXTRA_CAP_MS,
  BALL_MATERIALIZE_MS,
  SERVE_PENDING_AI_MS,
  LEGENDARY_SHAKE_INTENSITY, LEGENDARY_SHAKE_MS,
} from './constants.js';
import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { Renderer } from './renderer.js';
import { AIController } from './ai.js';
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
    vx: 0,
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
    breathPhase: side === 2 ? Math.PI : 0,
    chromaticTimer: 0,
    colorFlashTimer: 0,
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
  private ai: AIController;

  private lastTimestamp = 0;
  private rafId = 0;

  // Spin discovery tracking
  private rallyHits = 0;
  private spinDiscoveryShown = false;
  private spinDiscoveryTimer = 0;

  // Phase timers
  private phaseTimer = 0;       // POINT_SCORED exhale countdown (ms, counts down)
  private servePendingTimer = 0; // SERVE_PENDING elapsed (ms, counts up)
  private countdownTimer = 0;
  private countdownStep = 3;

  // End screen
  private endScreenIndex = 1;
  private sparksEarned = 0;

  // Serve direction: true = toward left (P1 receives), false = toward right (P2)
  private servingToward = true;

  // Rally drone tier management
  private currentDroneTier = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new InputManager();
    this.audio = new AudioManager();
    this.renderer = new Renderer(canvas);
    this.ai = new AIController();

    this.state = {
      phase: 'POINT_SCORED',
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
      materializeAlpha: 0,
      score1Pop: 1,
      score2Pop: 1,
    };

    // First serve uses the full breath ritual
    this.phaseTimer = EXHALE_BASE_MS;
    this.servingToward = true;
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
    const deltaMs = Math.min(timestamp - this.lastTimestamp, 80);
    this.lastTimestamp = timestamp;

    this.update(deltaMs);
    this.render();

    this.input.flush();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  // ─── Update dispatch ────────────────────────────────────────────────────

  private update(deltaMs: number): void {
    const { state } = this;

    switch (state.phase) {
      case 'PLAYING':
        this.updatePaddleMovement(deltaMs);
        this.ai.update(state.player2, state.ball, deltaMs);
        this.updateAnimations(deltaMs);
        this.updatePhysics(deltaMs);
        break;

      case 'POINT_SCORED':
        this.updateAnimations(deltaMs);
        this.slidePaddlesToCenter(deltaMs);
        this.tickPointScored(deltaMs);
        break;

      case 'SERVE_PENDING':
        this.updatePaddleMovement(deltaMs);
        this.ai.update(state.player2, state.ball, deltaMs);
        this.updateAnimations(deltaMs);
        this.tickServePending(deltaMs);
        break;

      case 'SERVING':
        this.updatePaddleMovement(deltaMs);
        this.ai.update(state.player2, state.ball, deltaMs);
        this.updateAnimations(deltaMs);
        this.tickServing(deltaMs);
        break;

      case 'MATCH_END':
        this.tickMatchEnd();
        break;
    }

    // Score pop easing — every frame regardless of phase
    this.tickScorePops(deltaMs);

    updateImpactRings(state.impactRings, deltaMs);
    updateWallMarks(state.wallMarks, deltaMs);
    updateGoalFlashes(state.goalFlashes, deltaMs);
    updateGoalParticles(state.goalParticles, deltaMs);
    updateScreenShake(state.shake, deltaMs);
    this.audio.tick(deltaMs);

    if (this.spinDiscoveryTimer > 0) {
      this.spinDiscoveryTimer = Math.max(0, this.spinDiscoveryTimer - deltaMs);
    }
  }

  // ─── Phase tick handlers ────────────────────────────────────────────────

  /**
   * POINT_SCORED — the exhale phase.
   * Paddles slide to center, ball materialises, then hands off to SERVE_PENDING.
   */
  private tickPointScored(deltaMs: number): void {
    // Animate ball fade-in from transparent → visible over BALL_MATERIALIZE_MS
    this.state.materializeAlpha = Math.min(
      1,
      this.state.materializeAlpha + deltaMs / BALL_MATERIALIZE_MS
    );

    this.phaseTimer -= deltaMs;
    if (this.phaseTimer <= 0) {
      this.state.phase = 'SERVE_PENDING';
      this.servePendingTimer = 0;
    }
  }

  /**
   * SERVE_PENDING — player signals ready by pressing a movement key.
   * AI auto-readies after SERVE_PENDING_AI_MS.
   */
  private tickServePending(deltaMs: number): void {
    this.servePendingTimer += deltaMs;

    const playerReady = this.input.p1Up() || this.input.p1Down();
    const aiReady = this.servePendingTimer >= SERVE_PENDING_AI_MS;

    if (playerReady || aiReady) {
      this.state.phase = 'SERVING';
      this.countdownStep = 3;
      this.countdownTimer = SERVE_COUNTDOWN_MS;
      this.audio.playCountdownBeep(0); // "3" — low beep
    }
  }

  private tickServing(deltaMs: number): void {
    this.countdownTimer -= deltaMs;
    if (this.countdownTimer <= 0) {
      this.countdownStep--;
      if (this.countdownStep > 0) {
        this.countdownTimer = SERVE_COUNTDOWN_MS;
        this.audio.playCountdownBeep(this.countdownStep === 1 ? 2 : 1);
      } else {
        resetBall(this.state.ball, this.servingToward);
        this.state.phase = 'PLAYING';
      }
    }
  }

  private tickMatchEnd(): void {
    const OPTIONS = 3;
    if (this.input.menuUp()) {
      this.endScreenIndex = (this.endScreenIndex - 1 + OPTIONS) % OPTIONS;
      this.audio.playMenuNav();
    }
    if (this.input.menuDown()) {
      this.endScreenIndex = (this.endScreenIndex + 1) % OPTIONS;
      this.audio.playMenuNav();
    }
    if (this.input.confirm()) {
      this.audio.playMenuConfirm();
      this.resetMatch();
    }
  }

  // ─── Score pop ─────────────────────────────────────────────────────────

  private tickScorePops(deltaMs: number): void {
    // Exponential ease-back to 1; delta-time independent
    const k = 1 - Math.exp(-10 * deltaMs / 1000);
    this.state.score1Pop += (1 - this.state.score1Pop) * k;
    this.state.score2Pop += (1 - this.state.score2Pop) * k;
  }

  // ─── Paddle slide to center (between points) ────────────────────────────

  private slidePaddlesToCenter(deltaMs: number): void {
    const targetY = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2;
    const k = 1 - Math.exp(-6 * deltaMs / 1000); // settles in ~0.5s
    for (const p of [this.state.player1, this.state.player2]) {
      p.prevY = p.y;
      p.y += (targetY - p.y) * k;
      p.vy = 0;
    }
  }

  // ─── Rally tier + drone ─────────────────────────────────────────────────

  private computeRallyTier(count: number): number {
    if (count >= RALLY_TIER_LEGENDARY) return 4;
    if (count >= RALLY_TIER_DRAMATIC)  return 3;
    if (count >= RALLY_TIER_INTENSE)   return 2;
    if (count >= RALLY_TIER_BUILDING)  return 1;
    return 0;
  }

  private updateRallyDrone(): void {
    const tier = this.computeRallyTier(this.state.rallyCount);
    if (tier !== this.currentDroneTier) {
      this.currentDroneTier = tier;
      this.audio.setRallyDrone(tier);
    }
  }

  // ─── Paddle movement (P1; P2 driven by AI) ─────────────────────────────

  private updatePaddleMovement(deltaMs: number): void {
    const { state, input } = this;
    const dt = deltaMs / 1000;
    const p1 = state.player1;

    p1.prevY = p1.y;

    const p1Up   = input.p1Up();
    const p1Down = input.p1Down();

    if (p1Up && !p1Down) {
      p1.vy = Math.max(p1.vy - PADDLE_ACCEL, -PADDLE_BASE_SPEED);
    } else if (p1Down && !p1Up) {
      p1.vy = Math.min(p1.vy + PADDLE_ACCEL, PADDLE_BASE_SPEED);
    } else {
      const speedNorm = Math.abs(p1.vy) / PADDLE_BASE_SPEED;
      const t = Math.pow(speedNorm, PADDLE_DECEL_CURVE);
      p1.vy *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t;
      if (Math.abs(p1.vy) < 1) p1.vy = 0;
    }

    p1.y += p1.vy * dt;
    p1.y = Math.max(0, Math.min(CANVAS_HEIGHT - p1.height, p1.y));
  }

  private updateAnimations(deltaMs: number): void {
    updatePaddleAnimations(this.state.player1, deltaMs);
    updatePaddleAnimations(this.state.player2, deltaMs);
  }

  // ─── Physics ────────────────────────────────────────────────────────────

  private updatePhysics(deltaMs: number): void {
    const { state } = this;

    const result = updateBall(
      state.ball,
      state.player1,
      state.player2,
      deltaMs,
      false
    );

    // ── Paddle hit ────────────────────────────────────────────────────
    if (result.hitPaddle !== null) {
      const hitPaddle = result.hitPaddle === 1 ? state.player1 : state.player2;
      const color     = result.hitPaddle === 1 ? COLOR_P1 : COLOR_P2;

      spawnImpactRing(state.impactRings, state.ball.x, state.ball.y, color);
      triggerShake(state.shake, SHAKE_HIT_INTENSITY, SHAKE_HIT_MS);

      const edgeFactor = (state.ball as Ball & { _edgeFactor?: number })._edgeFactor ?? 0;
      this.audio.playPaddleHit(state.ball.speed, edgeFactor);

      this.rallyHits++;
      state.rallyCount++;

      // Update drone when rally crosses a tier boundary
      this.updateRallyDrone();

      // Spin discovery: show once after 3 hits with a moving paddle
      if (!this.spinDiscoveryShown && this.rallyHits >= 3 && Math.abs(hitPaddle.vy) > 60) {
        this.spinDiscoveryShown = true;
        this.spinDiscoveryTimer = 1500;
        this.audio.playSpinDiscovery();
      }
    }

    // ── Wall bounce ───────────────────────────────────────────────────
    if (result.hitWall === 'top') {
      this.audio.playWallBounce();
      spawnWallMark(state.wallMarks, state.ball.x, 0);
    } else if (result.hitWall === 'bottom') {
      this.audio.playWallBounce();
      spawnWallMark(state.wallMarks, state.ball.x, CANVAS_HEIGHT);
    }

    // ── Goal ──────────────────────────────────────────────────────────
    if (result.goal !== null) {
      const isLegendary = state.rallyCount >= RALLY_TIER_LEGENDARY;

      // Stop drone immediately — silence is part of the release
      this.currentDroneTier = 0;
      this.audio.setRallyDrone(0);

      // Shake — legendary rallies earn a bigger quake
      if (isLegendary) {
        triggerShake(state.shake, LEGENDARY_SHAKE_INTENSITY, LEGENDARY_SHAKE_MS);
      } else {
        triggerShake(state.shake, SHAKE_GOAL_INTENSITY, SHAKE_GOAL_MS);
      }
      this.audio.playGoal(isLegendary);

      state.ball.sadTimer = BALL_SAD_MS;

      if (result.goal === 1) {
        state.score1++;
        state.score1Pop = 1.55;
        triggerPaddleEmotion(state.player1, true);
        triggerPaddleEmotion(state.player2, false);
        spawnGoalFlash(state.goalFlashes, 1);
        spawnGoalParticles(state.goalParticles, CANVAS_WIDTH, state.ball.y, COLOR_P2, Math.PI);
        this.servingToward = false; // P2 conceded → serve toward P2
      } else {
        state.score2++;
        state.score2Pop = 1.55;
        triggerPaddleEmotion(state.player2, true);
        triggerPaddleEmotion(state.player1, false);
        spawnGoalFlash(state.goalFlashes, 2);
        spawnGoalParticles(state.goalParticles, 0, state.ball.y, COLOR_P1, 0);
        this.servingToward = true; // P1 conceded → serve toward P1
      }

      // Exhale duration scales with how intense the rally was
      const extraMs = Math.min(state.rallyCount * EXHALE_PER_RALLY_HIT, EXHALE_EXTRA_CAP_MS);
      const exhaleMs = EXHALE_BASE_MS + extraMs;

      if (state.rallyCount > state.longestRally) {
        state.longestRally = state.rallyCount;
      }
      state.rallyCount = 0;
      this.rallyHits = 0;

      // Freeze ball at center; it will materialise during POINT_SCORED
      state.ball.vx = 0;
      state.ball.vy = 0;
      state.ball.x = CANVAS_WIDTH / 2;
      state.ball.y = CANVAS_HEIGHT / 2;
      state.ball.trail = [];
      state.materializeAlpha = 0;

      this.sparksEarned += SPARKS_PER_POINT;

      if (state.score1 >= MATCH_TARGET || state.score2 >= MATCH_TARGET) {
        this.sparksEarned += SPARKS_MATCH_WIN;
        state.phase = 'MATCH_END';
        this.endScreenIndex = 1;
        this.audio.playMatchWin();
      } else {
        state.phase = 'POINT_SCORED';
        this.phaseTimer = exhaleMs;
      }
    }
  }

  // ─── Match reset ────────────────────────────────────────────────────────

  private resetMatch(): void {
    const { state } = this;
    state.score1 = 0;
    state.score2 = 0;
    state.rallyCount = 0;
    state.longestRally = 0;
    state.impactRings = [];
    state.wallMarks = [];
    state.goalFlashes = [];
    state.goalParticles = [];
    state.ball = makeBall();
    state.player1 = makePaddle(1);
    state.player2 = makePaddle(2);
    state.shake = makeShake();
    state.materializeAlpha = 0;
    state.score1Pop = 1;
    state.score2Pop = 1;

    this.rallyHits = 0;
    this.sparksEarned = 0;
    this.currentDroneTier = 0;
    this.audio.setRallyDrone(0);
    this.ai.reset();
    this.servingToward = true;

    state.phase = 'POINT_SCORED';
    this.phaseTimer = EXHALE_BASE_MS;
  }

  // ─── Render ────────────────────────────────────────────────────────────

  private render(): void {
    const { state } = this;
    const [shakeX, shakeY] = getShakeOffset(state.shake);

    if (state.phase === 'MATCH_END') {
      const winner = state.score1 >= MATCH_TARGET ? 'PLAYER WINS!' : 'AI WINS!';
      this.renderer.drawEndScreen(
        winner,
        state.score1,
        state.score2,
        state.longestRally,
        this.sparksEarned,
        this.endScreenIndex
      );
      return;
    }

    // All in-play phases share the base scene
    this.renderer.draw(state, shakeX, shakeY);

    // Countdown overlay during the serve ritual
    if (state.phase === 'SERVING') {
      this.renderer.drawCountdown(String(this.countdownStep), state.ball);
    }

    // Spin discovery toast
    if (this.spinDiscoveryTimer > 0) {
      this.renderer.drawSpinDiscovery(
        state.ball.x, state.ball.y,
        Math.min(1, this.spinDiscoveryTimer / 400)
      );
    }
  }
}
