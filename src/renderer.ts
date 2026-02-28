// Renderer — all canvas drawing; pure output, no state mutation

import { Ball, Paddle, ImpactRing, WallMark, GoalFlash, GoalParticle, GameState, PowerUp, ActiveBoost, PowerUpType } from './types.js';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  COLOR_BG, COLOR_P1, COLOR_P2, COLOR_BALL, COLOR_COURT, COLOR_SPARK, COLOR_HIT_FLASH,
  GLOW_PADDLE, GLOW_BALL, GLOW_RING,
  TRAIL_LENGTH,
  SQUASH_DURATION_MS, STRETCH_DURATION_MS, SQUASH_AMOUNT, STRETCH_AMOUNT,
  BREATH_AMP_PX,
  CHROMATIC_OFFSET,
  RING_MAX_RADIUS, RING_DURATION_MS,
  WALL_MARK_FADE_MS,
  HIT_EYE_FLASH_MS, BALL_SAD_MS,
  PADDLE_COLOR_FLASH_MS,
  GOAL_FLASH_MS, GOAL_PARTICLE_MS,
  MATCH_TARGET,
  RALLY_TIER_BUILDING, RALLY_TIER_INTENSE, RALLY_TIER_DRAMATIC, RALLY_TIER_LEGENDARY,
  ZOOM_INTENSE, ZOOM_DRAMATIC, ZOOM_LEGENDARY,
  POWERUP_RADIUS, POWERUP_LIFETIME_MS, POWERUP_BOOST_MS, POWERUP_STICKY_HOLD_MS,
  COLOR_POWERUP_WIDE, COLOR_POWERUP_SPEED, COLOR_POWERUP_STICKY, COLOR_POWERUP_TRAIL,
  PADDLE_BASE_SPEED,
} from './constants.js';

/** How many trail points to display at a given rally count (trail grows with intensity). */
function trailDisplayCount(rallyCount: number): number {
  if (rallyCount >= RALLY_TIER_LEGENDARY) return 22;
  if (rallyCount >= RALLY_TIER_DRAMATIC)  return 18;
  if (rallyCount >= RALLY_TIER_INTENSE)   return 14;
  if (rallyCount >= RALLY_TIER_BUILDING)  return 12;
  return 10;
}

/** Canvas zoom factor (0 = none) at a given rally count. */
function rallyZoom(rallyCount: number): number {
  if (rallyCount >= RALLY_TIER_LEGENDARY) return ZOOM_LEGENDARY;
  if (rallyCount >= RALLY_TIER_DRAMATIC)  return ZOOM_DRAMATIC;
  if (rallyCount >= RALLY_TIER_INTENSE)   return ZOOM_INTENSE;
  return 0;
}

/** Escalating emoji label for the rally counter. Returns '' when too low to show. */
function getRallyLabel(count: number): string {
  if (count < 4)   return '';
  if (count >= 25) return `🌟 ${count} 🌟`;
  if (count >= 20) return `💥 ${count} 💥`;
  if (count >= 15) return `⚡ ${count} ⚡`;
  if (count >= 10) return `🔥 ${count} 🔥`;
  if (count >=  7) return `🏓 ${count} 🏓`;
  return              `🏓 ${count}`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    // Scale the canvas buffer to physical pixels so text/glow are sharp on
    // retina / high-DPI displays. All drawing code still uses 960×540 logical px.
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = CANVAS_WIDTH  * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    // Apply the DPR scale as the base transform. Because ctx.save()/restore()
    // is a stack, all nested pairs restore back to this scale — never to identity.
    ctx.scale(dpr, dpr);
  }

  // ─── Top-level draw ─────────────────────────────────────────────────────

  draw(state: GameState, shakeX: number, shakeY: number, gameTime = 0, godMode = false): void {
    const { ctx } = this;
    const rc = state.rallyCount;

    // ── Rally zoom — subtle "TV camera push-in" centered on canvas ───────
    const zoom = rallyZoom(rc);
    ctx.save(); // zoom context
    if (zoom > 0) {
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.scale(1 + zoom, 1 + zoom);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }

    // ── Shake ─────────────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Background — warms slightly toward red at Dramatic+ (subliminal tension)
    const warmth = rc >= RALLY_TIER_DRAMATIC ? Math.min((rc - RALLY_TIER_DRAMATIC) / 12, 1) : 0;
    this.drawBackground(warmth);
    this.drawWallMarks(state.wallMarks);

    // Court lines brighten with rally intensity
    const courtIntensity = 1 + Math.min(rc / RALLY_TIER_LEGENDARY, 1) * 1.8;
    this.drawCourt(courtIntensity);

    // Wall boundaries — thick glowing lines at top and bottom
    this.drawWallBoundaries(courtIntensity);

    this.drawGoalParticles(state.goalParticles);
    this.drawPowerUps(state.powerUps);
    const trailBlazer = state.activeBoosts.some(b => b.type === 'TRAIL_BLAZER') || godMode;
    this.drawBallTrail(state.ball, rc, trailBlazer);

    // Compute active boost flags for paddle rendering
    const p1SpeedBoost = godMode || state.activeBoosts.some(b => b.owner === 1 && b.type === 'SPEED_BOOTS');
    const p2SpeedBoost = state.activeBoosts.some(b => b.owner === 2 && b.type === 'SPEED_BOOTS');
    const p1WidePaddle = godMode || state.activeBoosts.some(b => b.owner === 1 && b.type === 'WIDE_PADDLE');
    const p2WidePaddle = state.activeBoosts.some(b => b.owner === 2 && b.type === 'WIDE_PADDLE');

    // Ball — materialize fade-in during exhale, gentle pulse while serving
    const isMaterialize = state.materializeAlpha < 0.99;
    const isPulsing = state.phase === 'SERVE_PENDING' || state.phase === 'SERVING';
    if (isMaterialize || isPulsing) {
      ctx.save();
      if (isMaterialize) ctx.globalAlpha = state.materializeAlpha;
      if (isPulsing) {
        const pulse = 1 + Math.sin(Date.now() * 0.006) * 0.07;
        // Temporarily scale ball radius for the pulse (render-only, restored below)
        const orig = state.ball.radius;
        state.ball.radius = orig * pulse;
        this.drawBall(state.ball);
        state.ball.radius = orig;
      } else {
        this.drawBall(state.ball);
      }
      ctx.restore();
    } else {
      this.drawBall(state.ball);
    }

    // Sticky paddle effect — pulsing rings on the paddle currently holding the ball
    if (state.ball.stickyHoldMs > 0 && state.ball.stickyOwner !== null) {
      const holdingPaddle = state.ball.stickyOwner === 1 ? state.player1 : state.player2;
      this.drawStickyPaddleEffect(holdingPaddle, state.ball.stickyHoldMs);
    }

    this.drawPaddle(state.player1, p1SpeedBoost, p1WidePaddle);
    this.drawPaddle(state.player2, p2SpeedBoost, p2WidePaddle);
    this.drawImpactRings(state.impactRings);
    this.drawGoalFlashes(state.goalFlashes);

    // Speed lines — appear at Dramatic tier, intensify toward Legendary
    if (rc >= RALLY_TIER_DRAMATIC) {
      this.drawSpeedLines(state.ball, rc);
    }

    ctx.restore(); // shake

    // HUD drawn outside shake so it stays stable (still inside zoom)
    this.drawHUD(state, gameTime, godMode);

    ctx.restore(); // zoom

    // Screen-edge pulse at Legendary — drawn outside zoom so it hits true edges
    if (rc >= RALLY_TIER_LEGENDARY) {
      this.drawEdgePulse(rc);
    }
  }

  // ─── Background ─────────────────────────────────────────────────────────

  /**
   * @param warmth  0–1 — shifts background very slightly warmer at high rally
   *                (#0a0a2e → #0f0a2e). Subliminal tension, barely perceptible.
   */
  private drawBackground(warmth = 0): void {
    const { ctx } = this;
    // Base: r=10 g=10 b=46. At full warmth: r=15 — just enough to feel "hot"
    const r = Math.round(10 + warmth * 5);
    ctx.fillStyle = `rgb(${r},10,46)`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // ─── Court ──────────────────────────────────────────────────────────────

  /**
   * @param intensity  1 = normal; higher values brighten the court lines to
   *                   build visible tension during long rallies.
   */
  private drawCourt(intensity = 1): void {
    const { ctx } = this;
    const alpha = Math.min(0.18 * intensity, 0.55);
    const style = `rgba(0,240,255,${alpha.toFixed(3)})`;

    // Dashed center line
    ctx.save();
    ctx.strokeStyle = style;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = intensity > 1.5 ? (intensity - 1) * 16 : 0;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Center circle
    ctx.save();
    ctx.strokeStyle = style;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = intensity > 1.5 ? (intensity - 1) * 10 : 0;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawToyCourtMarkings(): void {
    const { ctx } = this;
    // Right "wall" glow line — marks the right reflection boundary
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH - 1, 0);
    ctx.lineTo(CANVAS_WIDTH - 1, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.restore();
  }

  // ─── Wall Marks (scorch) ────────────────────────────────────────────────

  private drawWallMarks(marks: WallMark[]): void {
    const { ctx } = this;
    for (const mark of marks) {
      const alpha = Math.max(0, 1 - mark.age / WALL_MARK_FADE_MS);
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = COLOR_P1;
      ctx.shadowColor = COLOR_P1;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.ellipse(mark.x, mark.y, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Ball Trail ─────────────────────────────────────────────────────────

  private drawBallTrail(ball: Ball, rallyCount = 0, trailBlazer = false): void {
    const { ctx } = this;
    const blazeMult = trailBlazer ? 2 : 1;
    const rawLen = trailDisplayCount(rallyCount) * blazeMult;
    const displayLen = Math.min(ball.trail.length, rawLen);
    if (displayLen === 0) return;

    // At high rallies the trail gets brighter and more saturated
    const intensity = rallyCount >= RALLY_TIER_LEGENDARY ? 1
      : rallyCount >= RALLY_TIER_DRAMATIC  ? 0.75
      : rallyCount >= RALLY_TIER_INTENSE   ? 0.5
      : 0;
    const baseAlpha = (0.55 + intensity * 0.25) * (trailBlazer ? 1.4 : 1);

    for (let i = 0; i < displayLen; i++) {
      const pt = ball.trail[i];
      const age = (i + 1) / (displayLen + 1); // 0 = newest, 1 = oldest
      const alpha = (1 - age) * baseAlpha;
      const radius = ball.radius * (1 - age * 0.6);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLOR_P1;
      ctx.shadowColor = COLOR_P1;
      ctx.shadowBlur = (8 + intensity * 8) * (1 - age);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Ball ───────────────────────────────────────────────────────────────

  private drawBall(ball: Ball): void {
    const { ctx } = this;
    const angle = Math.atan2(ball.vy, ball.vx);

    // Compute squash/stretch scales
    let scaleX = 1;
    let scaleY = 1;

    // After ctx.rotate(angle), local X = travel direction, local Y = perpendicular.
    if (ball.squashTimer > 0) {
      // Squash against paddle face: compress in travel (local X), expand perp (local Y)
      const t = ball.squashTimer / SQUASH_DURATION_MS;
      const s = 1 + (SQUASH_AMOUNT - 1) * t; // s < 1 at peak
      scaleX = s;       // compressed in travel direction
      scaleY = 1 / s;   // expanded perpendicular
    } else if (ball.stretchTimer > 0) {
      // Stretch in travel direction: elongate local X, narrow local Y
      const t = ball.stretchTimer / STRETCH_DURATION_MS;
      const s = 1 + (STRETCH_AMOUNT - 1) * t; // s > 1 at peak
      scaleX = s;       // elongated in travel direction
      scaleY = 1 / s;   // narrowed perpendicular
    }

    // Outer glow
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(angle);
    ctx.scale(scaleX, scaleY);

    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = GLOW_BALL;
    ctx.fillStyle = COLOR_P1;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // White-hot core
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(angle);
    ctx.scale(scaleX, scaleY);

    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = GLOW_BALL;
    ctx.fillStyle = COLOR_BALL;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Hit flash: orange tint fades out over hitFlashTimer duration
    if (ball.hitFlashTimer > 0) {
      const flashT = ball.hitFlashTimer / HIT_EYE_FLASH_MS;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(angle);
      ctx.scale(scaleX, scaleY);
      ctx.globalAlpha = flashT * 0.85;
      ctx.fillStyle = COLOR_SPARK; // '#ffe600' yellow-orange
      ctx.shadowColor = COLOR_SPARK;
      ctx.shadowBlur = 18 * flashT;
      ctx.beginPath();
      ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Eye + Mouth — both in world space, no rotation, x mirrors with vx sign.
    ctx.save();
    ctx.translate(ball.x, ball.y);
    this.drawBallEye(ball);
    this.drawBallMouth(ball);
    ctx.restore();

    // Spin indicator lines (subtle rotation marks)
    if (Math.abs(ball.spin) > 0.02) {
      this.drawSpinLines(ball, angle);
    }

    // Sticky hold visual — magenta corona + depleting arc timer
    if (ball.stickyHoldMs > 0) {
      this.drawStickyBallEffect(ball);
    }
  }

  // Eye — drawn in world space (origin = ball centre, NO rotation).
  // Always sits in the upper half; x-position mirrors with horizontal direction.
  private drawBallEye(ball: Ball): void {
    const { ctx } = this;
    const r       = ball.radius;
    const speedT  = Math.max(0, Math.min((ball.speed - 280) / 440, 1));

    // x flips with horizontal direction so the eye stays on the leading side
    const dirX = ball.vx >= 0 ? 1 : -1;
    const eyeX = r * 0.15 * dirX;
    const eyeY = -r * 0.35;   // always above centre

    // Eye radius reacts: wider on hit (1.3x), smaller when sad (0.8x)
    let eyeR = r * 0.30;
    if (ball.hitFlashTimer > 0) {
      const flashT = ball.hitFlashTimer / HIT_EYE_FLASH_MS;
      eyeR *= 1 + 0.3 * flashT;   // up to 1.3x
    } else if (ball.sadTimer > 0) {
      eyeR *= 0.8;                 // 0.8x when sad
    }

    ctx.save();
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap     = 'round';

    if (speedT > 0.65) {
      // Happy squint: ∩ arc
      ctx.strokeStyle = '#000000';
      ctx.lineWidth   = eyeR * 0.90;
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeR * 0.75, Math.PI + 0.5, 2 * Math.PI - 0.5);
      ctx.stroke();
    } else {
      // Normal filled eye
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight — ~20% of eye size at 10 o'clock (upper-left)
      const hlR  = eyeR * 0.28;
      const hlDx = eyeR * 0.38 * Math.cos(7 * Math.PI / 6);
      const hlDy = eyeR * 0.38 * Math.sin(7 * Math.PI / 6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(eyeX + hlDx, eyeY + hlDy, hlR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Mouth — world space, no rotation. x mirrors with vx sign, always lower half.
  // Smile: arc(cx, cy, r, 0, π, false) = clockwise right→bottom→left = ∪
  // Frown: arc(cx, cy, r, 0, π, true)  = counterclockwise right→top→left = ∩
  private drawBallMouth(ball: Ball): void {
    const { ctx } = this;
    const r      = ball.radius;
    const dirX   = ball.vx >= 0 ? 1 : -1;
    const mouthX = r * 0.70 * dirX;  // pushed to forward edge of ball
    const mouthY = r * 0.30;
    const mouthR = r * 0.28;
    const sad    = ball.sadTimer > 0;

    ctx.save();
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    // Frown: slightly above center (mouthY - mouthR*0.5) so it sits in lower half
    const arcY = sad ? mouthY - mouthR * 0.6 : mouthY;
    ctx.arc(mouthX, arcY, mouthR, 0, Math.PI, sad);
    ctx.stroke();
    ctx.restore();
  }

  private drawSpinLines(ball: Ball, angle: number): void {
    const { ctx } = this;
    // Normalize to [0,1] — full intensity at spin ~0.15
    const spinIntensity = Math.min(Math.abs(ball.spin) / 0.15, 1);
    const numLines = 3;
    const innerR = ball.radius * 0.25;
    const outerR = ball.radius * 0.95;

    ctx.save();
    ctx.globalAlpha = 0.65 * spinIntensity;
    ctx.strokeStyle = COLOR_BALL;
    ctx.lineWidth = 1.5;
    ctx.translate(ball.x, ball.y);

    for (let i = 0; i < numLines; i++) {
      // spinAngle accumulates proportional to spin magnitude — slows as spin decays
      const baseAngle = (i / numLines) * Math.PI * 2 + ball.spinAngle;
      ctx.beginPath();
      ctx.moveTo(Math.cos(baseAngle) * innerR, Math.sin(baseAngle) * innerR);
      ctx.lineTo(Math.cos(baseAngle) * outerR, Math.sin(baseAngle) * outerR);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Goal Flash ─────────────────────────────────────────────────────────

  // Full-width flash on the scoring side of the court.
  // side 1 = P1 scored → right half flashes; side 2 = P2 scored → left half.
  private drawGoalFlashes(flashes: GoalFlash[]): void {
    const { ctx } = this;
    for (const flash of flashes) {
      const t = flash.age / GOAL_FLASH_MS;
      // Hold at 20% for first quarter (≈ 2 frames), fade to 0 over the rest
      const alpha = t < 0.25 ? 0.20 : 0.20 * (1 - (t - 0.25) / 0.75);
      const x = flash.side === 1 ? CANVAS_WIDTH / 2 : 0;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
      ctx.restore();
    }
  }

  // ─── Goal Particles ──────────────────────────────────────────────────────

  private drawGoalParticles(particles: GoalParticle[]): void {
    const { ctx } = this;
    for (const p of particles) {
      const alpha = Math.max(0, 1 - p.age / GOAL_PARTICLE_MS);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Paddle ─────────────────────────────────────────────────────────────

  drawPaddle(paddle: Paddle, speedBoost = false, widePaddle = false): void {
    const { ctx } = this;
    const baseColor = paddle.id === 1 ? COLOR_P1 : COLOR_P2;

    // Color flash: lerp base color → orange → base over PADDLE_COLOR_FLASH_MS
    // Uses a tent curve so the peak orange is at the midpoint of the animation,
    // giving a clear "blue → orange → blue" transition.
    let color = baseColor;
    if (paddle.colorFlashTimer > 0) {
      const t = paddle.colorFlashTimer / PADDLE_COLOR_FLASH_MS; // 1 → 0
      // Tent: sin(t*π) peaks at t=0.5 → sin(π/2)=1. At t=1 and t=0 it's 0.
      // But we want instant orange at hit, so shift peak earlier: sin(t * π * 0.9 + 0.1)
      const intensity = Math.sin(t * Math.PI);
      color = this.lerpColor(baseColor, COLOR_HIT_FLASH, intensity);
    }

    const px = paddle.x + paddle.recoilOffset;
    const py = paddle.y + paddle.emotionOffset;
    const pw = paddle.width;
    // Subtle breathing: oscillate height slightly
    const breath = Math.sin(paddle.breathPhase) * BREATH_AMP_PX;
    const ph = paddle.height + breath;
    const pyAdj = py - breath / 2; // keep center stable

    // Chromatic aberration flash
    if (paddle.chromaticTimer > 0) {
      const t = paddle.chromaticTimer / 50;
      const off = CHROMATIC_OFFSET * t;

      ctx.save();
      ctx.globalAlpha = 0.45 * t;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(px - off, pyAdj, pw, ph);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(px + off, pyAdj, pw, ph);
      ctx.restore();
    }

    // Glow halo — blooms brighter and wider during color flash
    const flashBoost = paddle.colorFlashTimer > 0
      ? Math.sin((paddle.colorFlashTimer / PADDLE_COLOR_FLASH_MS) * Math.PI)
      : 0;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = GLOW_PADDLE * 1.5 + flashBoost * 24;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25 + flashBoost * 0.35;
    ctx.fillRect(px - 2, pyAdj - 2, pw + 4, ph + 4);
    ctx.restore();

    // Main paddle body
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = GLOW_PADDLE + flashBoost * 12;
    ctx.fillStyle = color;
    ctx.fillRect(px, pyAdj, pw, ph);
    ctx.restore();

    // ── WIDE_PADDLE: glowing end-caps at the extended top and bottom edges ──
    if (widePaddle) {
      ctx.save();
      ctx.strokeStyle = COLOR_POWERUP_WIDE;
      ctx.shadowColor = COLOR_POWERUP_WIDE;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(Date.now() * 0.004);
      // Top cap
      ctx.beginPath();
      ctx.moveTo(px - 3, pyAdj);
      ctx.lineTo(px + pw + 3, pyAdj);
      ctx.stroke();
      // Bottom cap
      ctx.beginPath();
      ctx.moveTo(px - 3, pyAdj + ph);
      ctx.lineTo(px + pw + 3, pyAdj + ph);
      ctx.stroke();
      ctx.restore();
    }

    // ── SPEED_BOOTS: vertical motion streaks shooting from the leading edge ──
    if (speedBoost) {
      const speedFrac = Math.min(Math.abs(paddle.vy) / (PADDLE_BASE_SPEED * 0.8), 1);
      if (speedFrac > 0.15) {
        const dir = paddle.vy > 0 ? 1 : -1;
        // Streaks shoot FROM the leading edge (top if moving up, bottom if moving down)
        const edgeY = dir > 0 ? pyAdj + ph : pyAdj;
        ctx.save();
        ctx.strokeStyle = COLOR_POWERUP_SPEED;
        ctx.shadowColor = COLOR_POWERUP_SPEED;
        ctx.shadowBlur = 8;
        ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const xFrac = (i + 0.5) / 4;
          const streakLen = speedFrac * 18 * (0.6 + 0.4 * Math.sin(Date.now() * 0.01 + i));
          ctx.globalAlpha = speedFrac * (0.75 - i * 0.15);
          ctx.lineWidth = 1.8 - i * 0.3;
          ctx.beginPath();
          ctx.moveTo(px + pw * xFrac, edgeY);
          ctx.lineTo(px + pw * xFrac, edgeY + dir * streakLen);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /** Linear RGB interpolation between two hex/rgb color strings. t=0 → c1, t=1 → c2. */
  private lerpColor(c1: string, c2: string, t: number): string {
    const parse = (c: string) => {
      const m = c.match(/\w\w/g)!;
      return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
    };
    const [r1, g1, b1] = parse(c1);
    const [r2, g2, b2] = parse(c2);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }

  // ─── Speed Lines (Dramatic+) ─────────────────────────────────────────────

  /** Thin lines trailing behind the ball in the direction opposite to travel. */
  private drawSpeedLines(ball: Ball, rallyCount: number): void {
    const { ctx } = this;
    const t = Math.min((rallyCount - RALLY_TIER_DRAMATIC) / 12, 1);
    const numLines = 4 + Math.round(t * 3);
    const spread = 0.45;
    const backAngle = Math.atan2(ball.vy, ball.vx) + Math.PI;

    ctx.save();
    ctx.globalAlpha = 0.28 + t * 0.28;
    ctx.strokeStyle = COLOR_P1;
    ctx.lineWidth = 0.8;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 4;

    for (let i = 0; i < numLines; i++) {
      // Use spinAngle for smooth deterministic variation (no per-frame random flicker)
      const lineAngle = backAngle + (i / (numLines - 1) - 0.5) * spread;
      const length = 18 + t * 28 + Math.sin(ball.spinAngle + i * 1.3) * 6;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(
        ball.x + Math.cos(lineAngle) * length,
        ball.y + Math.sin(lineAngle) * length
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Screen Edge Pulse (Legendary) ───────────────────────────────────────

  /** Breathing glow around the screen edges — the court is alive at 20+ hits. */
  private drawEdgePulse(rallyCount: number): void {
    const { ctx } = this;
    const t = Math.min((rallyCount - RALLY_TIER_LEGENDARY) / 15, 1);
    const pulse = (Math.sin(Date.now() * 0.004) + 1) / 2; // 0–1 at ~2Hz

    ctx.save();
    ctx.strokeStyle = COLOR_P1;
    ctx.lineWidth = 5 + pulse * 5;
    ctx.globalAlpha = (0.12 + t * 0.18) * (0.4 + pulse * 0.6);
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 20 + pulse * 20;
    ctx.strokeRect(1, 1, CANVAS_WIDTH - 2, CANVAS_HEIGHT - 2);
    ctx.restore();
  }

  // ─── Impact Rings ───────────────────────────────────────────────────────

  private drawImpactRings(rings: ImpactRing[]): void {
    const { ctx } = this;
    for (const ring of rings) {
      const progress = ring.age / RING_DURATION_MS;      // 0 → 1
      const radius = progress * RING_MAX_RADIUS;
      const alpha = (1 - progress) * 0.85;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1.5 * (1 - progress * 0.7);
      ctx.shadowColor = ring.color;
      ctx.shadowBlur = GLOW_RING * (1 - progress);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ─── HUD ────────────────────────────────────────────────────────────────

  private drawHUD(state: GameState, gameTime = 0, godMode = false): void {
    const { ctx } = this;
    const cx = CANVAS_WIDTH / 2;
    const p1x = cx - 70;
    const p2x = cx + 70;

    // Subtle difficulty badge — below P2 boost icon area
    {
      const diffColor = state.difficulty === 'HARD' ? COLOR_P2
        : state.difficulty === 'EASY' ? '#44ff88'
        : COLOR_P1;
      ctx.save();
      ctx.textAlign = 'right';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = diffColor;
      ctx.globalAlpha = 0.35;
      ctx.fillText(state.difficulty, CANVAS_WIDTH - 10, 44);
      ctx.restore();
    }

    // Score numbers with pop scale animation
    const drawScore = (score: number, pop: number, x: number, y: number, color: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.font = 'bold 56px system-ui, -apple-system, Arial, sans-serif';
      ctx.shadowColor = color;
      ctx.shadowBlur = 16 + (pop - 1) * 40; // extra glow during pop
      ctx.fillStyle = color;
      ctx.fillText(String(score), 0, 0);
      ctx.restore();
    };
    drawScore(state.score1, state.score1Pop, p1x, 64, COLOR_P1);
    drawScore(state.score2, state.score2Pop, p2x, 64, COLOR_P2);

    // Match-target pip dots
    this.drawMatchPips(p1x, state.score1, COLOR_P1);
    this.drawMatchPips(p2x, state.score2, COLOR_P2);

    // Bottom center: rally counter
    {
      const label = getRallyLabel(state.rallyCount);
      if (label) {
        const heat = Math.min((state.rallyCount - 4) / 21, 1);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(14 + heat * 6)}px system-ui, 'Apple Color Emoji', sans-serif`;
        ctx.shadowColor = `rgba(255, 160, 0, ${0.5 + heat * 0.5})`;
        ctx.shadowBlur = 4 + heat * 18;
        const g = Math.round(255 - heat * 105);
        const b = Math.round(255 - heat * 255);
        ctx.fillStyle = `rgba(255, ${g}, ${Math.max(0, b)}, ${0.6 + heat * 0.35})`;
        ctx.fillText(label, cx, CANVAS_HEIGHT - 14);
        ctx.restore();
      }
    }

    // Active boost icons near each paddle (always drawn in god mode)
    if (state.activeBoosts.length > 0 || godMode) {
      this.drawActiveBoostHUD(state.activeBoosts, gameTime, godMode);
    }
  }

  /** Draw MATCH_TARGET pip dots under a score, filled up to `scored`. */
  private drawMatchPips(centerX: number, scored: number, color: string): void {
    const { ctx } = this;
    const r   = 3.5;  // dot radius px
    const gap = 11;   // center-to-center spacing px
    const startX = centerX - ((MATCH_TARGET - 1) * gap) / 2;
    const y = 82;

    for (let i = 0; i < MATCH_TARGET; i++) {
      const x = startX + i * gap;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (i < scored) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.globalAlpha = 0.9;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.22;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ─── Countdown ──────────────────────────────────────────────────────────

  drawCountdown(text: string, ball: Ball): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 80px "Courier New", monospace';
    ctx.fillStyle = COLOR_P1;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 30;
    ctx.globalAlpha = 0.9;
    ctx.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 28);
    ctx.restore();
  }

  // ─── Spin discovery label (external call) ──────────────────────────────

  drawSpinDiscovery(x: number, y: number, alpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 17px "Courier New", monospace';
    ctx.fillStyle = COLOR_SPARK;
    ctx.textAlign = 'center';
    ctx.shadowColor = COLOR_SPARK;
    ctx.shadowBlur = 14;
    ctx.fillText('✧  SPIN  ✧', x, y - 22);
    ctx.restore();
  }

  // ─── Power-Up Orbs ───────────────────────────────────────────────────────

  private powerUpColor(type: PowerUpType): string {
    switch (type) {
      case 'WIDE_PADDLE':   return COLOR_POWERUP_WIDE;
      case 'SPEED_BOOTS':   return COLOR_POWERUP_SPEED;
      case 'STICKY_PADDLE': return COLOR_POWERUP_STICKY;
      case 'TRAIL_BLAZER':  return COLOR_POWERUP_TRAIL;
    }
  }

  private powerUpLabel(type: PowerUpType): string {
    switch (type) {
      case 'WIDE_PADDLE':   return 'WIDE PADDLE';
      case 'SPEED_BOOTS':   return 'SPEED BOOTS';
      case 'STICKY_PADDLE': return 'STICKY';
      case 'TRAIL_BLAZER':  return 'TRAIL BLAZER';
    }
  }

  /**
   * Draw a mini icon for a power-up type.
   * Origin is the centre of the orb; drawn in white so it pops on the
   * coloured fill. `r` is the usable icon radius (a fraction of POWERUP_RADIUS).
   */
  private drawPowerUpIcon(type: PowerUpType, r: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle   = 'rgba(0,0,0,0.72)';
    ctx.strokeStyle = 'rgba(0,0,0,0.72)';
    ctx.lineWidth   = 1.8;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = 0;

    switch (type) {
      case 'WIDE_PADDLE': {
        // Tall thin paddle silhouette — bar top + bar bottom + spine
        const w = r * 0.28;
        const h = r * 0.92;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        // Two bright horizontal tick marks at top and bottom
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-w * 1.6, -h / 2);
        ctx.lineTo( w * 1.6, -h / 2);
        ctx.moveTo(-w * 1.6,  h / 2);
        ctx.lineTo( w * 1.6,  h / 2);
        ctx.stroke();
        break;
      }

      case 'SPEED_BOOTS': {
        // Lightning bolt ⚡ polygon
        const pts: [number, number][] = [
          [-0.15 * r, -0.90 * r],
          [ 0.35 * r, -0.10 * r],
          [ 0.05 * r, -0.10 * r],
          [ 0.15 * r,  0.90 * r],
          [-0.35 * r,  0.10 * r],
          [-0.05 * r,  0.10 * r],
        ];
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'STICKY_PADDLE': {
        // Bullseye — filled inner disc + outer ring
        const inner = r * 0.30;
        const outer = r * 0.72;
        ctx.beginPath();
        ctx.arc(0, 0, inner, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, outer, 0, Math.PI * 2);
        ctx.lineWidth = r * 0.20;
        ctx.stroke();
        break;
      }

      case 'TRAIL_BLAZER': {
        // Comet — small circle + three fading lines trailing to the left
        const cr = r * 0.28;
        ctx.beginPath();
        ctx.arc(r * 0.20, 0, cr, 0, Math.PI * 2);
        ctx.fill();
        // Three tail lines spreading leftward
        const tailLengths = [r * 0.70, r * 0.55, r * 0.40];
        const offsets     = [0, r * 0.22, -r * 0.22];
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = (i === 0 ? 0.72 : 0.40);
          ctx.beginPath();
          ctx.moveTo(r * 0.05, offsets[i]);
          ctx.lineTo(r * 0.05 - tailLengths[i], offsets[i]);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }

  private drawPowerUps(powerUps: PowerUp[]): void {
    const { ctx } = this;
    for (const pu of powerUps) {
      const color = this.powerUpColor(pu.type);

      // Fade-in over first 400ms
      const fadeIn = Math.min(1, pu.age / 400);

      // Warning flash in last 25% of lifetime
      let alpha = fadeIn;
      if (pu.age > POWERUP_LIFETIME_MS * 0.75) {
        alpha = fadeIn * (0.35 + 0.65 * Math.abs(Math.sin(pu.age * 0.015)));
      }

      // Outer pulsing glow ring
      const pulse = 0.7 + 0.3 * Math.sin(pu.age * 0.004);
      ctx.save();
      ctx.globalAlpha = alpha * 0.45 * pulse;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 * pulse;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, POWERUP_RADIUS + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Filled orb body
      ctx.save();
      ctx.globalAlpha = alpha * 0.88;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, POWERUP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Mini icon — drawn in orb-space, rotates gently with spinAngle
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pu.x, pu.y);
      ctx.rotate(pu.spinAngle);
      this.drawPowerUpIcon(pu.type, POWERUP_RADIUS * 0.68);
      ctx.restore();

      // Label beside the orb — left or right based on x position
      const labelRight = pu.x < CANVAS_WIDTH / 2;
      const labelX = labelRight
        ? pu.x + POWERUP_RADIUS + 10
        : pu.x - POWERUP_RADIUS - 10;
      ctx.save();
      ctx.globalAlpha = alpha * 0.92;
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.textAlign = labelRight ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.powerUpLabel(pu.type), labelX, pu.y);
      ctx.restore();
    }
  }

  // ─── Active Boost HUD ────────────────────────────────────────────────────

  private drawActiveBoostHUD(boosts: ActiveBoost[], gameTime: number, godMode = false): void {
    const { ctx } = this;

    const ALL_TYPES: PowerUpType[] = ['WIDE_PADDLE', 'SPEED_BOOTS', 'STICKY_PADDLE', 'TRAIL_BLAZER'];

    // God mode: P1 always shows all 4 at full bars
    const p1Boosts: ActiveBoost[] = godMode
      ? ALL_TYPES.map(t => ({ type: t, owner: 1 as const, expiresAt: Infinity }))
      : boosts.filter(b => b.owner === 1 && b.expiresAt > gameTime);
    const p2Boosts = boosts.filter(b => b.owner === 2 && b.expiresAt > gameTime);

    // Horizontal row layout at the very top of the screen
    const iconSide = 20;
    const barH     = 2;
    const iconGap  = 4;
    const topY     = 7;  // distance from top edge

    // P1 icons: left-aligned from x=8, expanding rightward
    const drawRow = (playerBoosts: ActiveBoost[], rightAlign: boolean) => {
      const totalW = playerBoosts.length * iconSide + Math.max(0, playerBoosts.length - 1) * iconGap;
      const startX = rightAlign ? CANVAS_WIDTH - 8 - totalW : 8;

      playerBoosts.forEach((boost, i) => {
        const color     = this.powerUpColor(boost.type);
        const remaining = Math.min(1, Math.max(0, (boost.expiresAt - gameTime) / POWERUP_BOOST_MS));
        const x  = startX + i * (iconSide + iconGap);
        const cy = topY + iconSide / 2;

        ctx.save();

        // Dark pill background
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = 'rgba(0,0,0,0.60)';
        ctx.beginPath();
        ctx.roundRect(x, topY, iconSide, iconSide, 4);
        ctx.fill();

        // Coloured tint (scales with remaining)
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 5;
        ctx.globalAlpha = 0.18 + remaining * 0.28;
        ctx.beginPath();
        ctx.roundRect(x, topY, iconSide, iconSide, 4);
        ctx.fill();

        // Mini icon
        ctx.globalAlpha = 0.92;
        ctx.shadowBlur = 0;
        ctx.translate(x + iconSide / 2, cy);
        this.drawPowerUpIcon(boost.type, iconSide * 0.33);
        ctx.translate(-(x + iconSide / 2), -cy);

        // Drain bar flush below icon
        ctx.globalAlpha = 0.70;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, topY + iconSide + 1, iconSide, barH);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 3;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, topY + iconSide + 1, iconSide * remaining, barH);

        ctx.restore();
      });
    };

    drawRow(p1Boosts, false);
    drawRow(p2Boosts, true);

    // God mode badge — pulsing ⚡ GOD just to the right of P1 icons
    if (godMode) {
      const pulse = 0.72 + 0.28 * Math.sin(Date.now() * 0.005);
      const badgeX = 8 + ALL_TYPES.length * (iconSide + iconGap) + 6;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillStyle = '#ffe600';
      ctx.shadowColor = '#ffe600';
      ctx.shadowBlur = 10;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ GOD', badgeX, topY + iconSide / 2);
      ctx.restore();
    }
  }

  // ─── Wall Boundaries ─────────────────────────────────────────────────────

  /** Thick glowing lines at top and bottom edges — shows the solid walls. */
  private drawWallBoundaries(courtIntensity = 1): void {
    const { ctx } = this;
    const thickness = 5;
    const alpha = Math.min(0.7 + (courtIntensity - 1) * 0.2, 0.95);
    const blur  = 8 + (courtIntensity - 1) * 6;

    ctx.save();
    ctx.fillStyle = COLOR_P1;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, CANVAS_WIDTH, thickness);                          // top wall
    ctx.fillRect(0, CANVAS_HEIGHT - thickness, CANVAS_WIDTH, thickness);  // bottom wall
    ctx.restore();
  }

  // ─── Sticky effects ──────────────────────────────────────────────────────

  /** Pulsing magenta glow + depleting arc timer around the held ball. */
  private drawStickyBallEffect(ball: Ball): void {
    const { ctx } = this;
    const progress = ball.stickyHoldMs / POWERUP_STICKY_HOLD_MS; // 1→0
    const pulse    = 0.7 + 0.3 * Math.sin(Date.now() * 0.018);

    // Pulsing magenta corona
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.globalAlpha = 0.55 * pulse;
    ctx.strokeStyle = COLOR_POWERUP_STICKY;
    ctx.shadowColor = COLOR_POWERUP_STICKY;
    ctx.shadowBlur  = 16;
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Depleting arc — full circle when just caught, shrinks to zero before release
    const arcLen = progress * Math.PI * 2;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.globalAlpha = 0.90;
    ctx.strokeStyle = COLOR_POWERUP_STICKY;
    ctx.shadowColor = COLOR_POWERUP_STICKY;
    ctx.shadowBlur  = 12;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius + 7, -Math.PI / 2, -Math.PI / 2 + arcLen);
    ctx.stroke();
    ctx.restore();
  }

  /** Pulsing concentric rings on the paddle that's holding the ball. */
  private drawStickyPaddleEffect(paddle: Paddle, stickyHoldMs: number): void {
    const { ctx } = this;
    const cx   = paddle.x + paddle.recoilOffset + paddle.width / 2;
    const cy   = paddle.y + paddle.emotionOffset + paddle.height / 2;
    const t    = Date.now() * 0.007;

    for (let i = 0; i < 3; i++) {
      const ringT = ((t + i * 0.8) % (Math.PI * 2)) / (Math.PI * 2);
      const radius = 8 + ringT * 22;
      const alpha  = (1 - ringT) * 0.55;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle  = COLOR_POWERUP_STICKY;
      ctx.shadowColor  = COLOR_POWERUP_STICKY;
      ctx.shadowBlur   = 10;
      ctx.lineWidth    = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

}
