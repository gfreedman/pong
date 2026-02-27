// Renderer — all canvas drawing; pure output, no state mutation

import { Ball, Paddle, ImpactRing, WallMark, GoalFlash, GoalParticle, GameState, GamePhase } from './types.js';
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
} from './constants.js';

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;
  }

  // ─── Top-level draw ─────────────────────────────────────────────────────

  draw(state: GameState, shakeX: number, shakeY: number): void {
    const { ctx } = this;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawBackground();
    this.drawWallMarks(state.wallMarks);
    this.drawCourt();
    this.drawGoalParticles(state.goalParticles);
    this.drawBallTrail(state.ball);
    this.drawBall(state.ball);
    this.drawPaddle(state.player1);
    this.drawPaddle(state.player2);
    this.drawImpactRings(state.impactRings);
    this.drawGoalFlashes(state.goalFlashes);

    ctx.restore();

    // HUD drawn outside shake so it stays stable
    this.drawHUD(state);
  }

  drawToyMode(state: GameState, shakeX: number, shakeY: number): void {
    const { ctx } = this;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawBackground();
    this.drawWallMarks(state.wallMarks);
    this.drawToyCourtMarkings();
    this.drawGoalParticles(state.goalParticles);
    this.drawBallTrail(state.ball);
    this.drawBall(state.ball);
    this.drawPaddle(state.player1);
    this.drawImpactRings(state.impactRings);
    this.drawGoalFlashes(state.goalFlashes);

    ctx.restore();
  }

  // ─── Background ─────────────────────────────────────────────────────────

  private drawBackground(): void {
    const { ctx } = this;
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // ─── Court ──────────────────────────────────────────────────────────────

  private drawCourt(): void {
    const { ctx } = this;
    // Dashed center line
    ctx.save();
    ctx.strokeStyle = COLOR_COURT;
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
    ctx.strokeStyle = COLOR_COURT;
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

  private drawBallTrail(ball: Ball): void {
    const { ctx } = this;
    const len = ball.trail.length;
    if (len === 0) return;

    for (let i = 0; i < len; i++) {
      const pt = ball.trail[i];
      const age = (i + 1) / (TRAIL_LENGTH + 1); // 0 = newest, 1 = oldest
      const alpha = (1 - age) * 0.55;
      const radius = ball.radius * (1 - age * 0.6);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLOR_P1;
      ctx.shadowColor = COLOR_P1;
      ctx.shadowBlur = 8 * (1 - age);
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

  drawPaddle(paddle: Paddle): void {
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

  private drawHUD(state: GameState): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';

    // Scores
    ctx.font = 'bold 52px "Courier New", monospace';
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR_P1;
    ctx.fillText(String(state.score1), CANVAS_WIDTH / 2 - 70, 64);

    ctx.shadowColor = COLOR_P2;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR_P2;
    ctx.fillText(String(state.score2), CANVAS_WIDTH / 2 + 70, 64);

    // Rally counter (subtle, bottom center)
    if (state.rallyCount > 3) {
      ctx.shadowColor = 'rgba(255,255,255,0.5)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '14px "Courier New", monospace';
      ctx.fillText(`RALLY  ${state.rallyCount}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 16);
    }

    ctx.restore();
  }

  // ─── Menu screen ────────────────────────────────────────────────────────

  drawMenu(selectedIndex: number, options: string[], sparks: number): void {
    const { ctx } = this;
    this.drawBackground();

    // Title
    ctx.save();
    ctx.textAlign = 'center';
    const pulse = 0.85 + 0.15 * Math.sin(Date.now() * 0.002);
    ctx.globalAlpha = pulse;
    ctx.font = 'bold 64px "Courier New", monospace';
    ctx.fillStyle = COLOR_P1;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 30;
    ctx.fillText('NEON PONG', CANVAS_WIDTH / 2, 160);
    ctx.restore();

    // Menu options
    const startY = 260;
    const lineH = 50;
    options.forEach((label, i) => {
      const y = startY + i * lineH;
      const isSelected = i === selectedIndex;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `${isSelected ? 'bold ' : ''}26px "Courier New", monospace`;
      ctx.fillStyle = isSelected ? COLOR_P1 : 'rgba(200,200,255,0.55)';
      if (isSelected) {
        ctx.shadowColor = COLOR_P1;
        ctx.shadowBlur = 18;
      }
      ctx.fillText((isSelected ? '▸  ' : '   ') + label, CANVAS_WIDTH / 2, y);
      ctx.restore();
    });

    // Sparks display
    if (sparks > 0) {
      ctx.save();
      ctx.font = '16px "Courier New", monospace';
      ctx.fillStyle = COLOR_SPARK;
      ctx.textAlign = 'right';
      ctx.shadowColor = COLOR_SPARK;
      ctx.shadowBlur = 8;
      ctx.fillText(`⚡ ${sparks}`, CANVAS_WIDTH - 24, 30);
      ctx.restore();
    }
  }

  drawModeSelect(selectedIndex: number, options: string[], title: string): void {
    this.drawBackground();
    this.drawCenteredMenu(title, options, selectedIndex);
  }

  // ─── End screen ─────────────────────────────────────────────────────────

  drawEndScreen(
    winnerLabel: string,
    score1: number,
    score2: number,
    longestRally: number,
    sparksEarned: number,
    selectedIndex: number
  ): void {
    const { ctx } = this;
    this.drawBackground();

    ctx.save();
    ctx.textAlign = 'center';

    // Winner
    ctx.font = 'bold 46px "Courier New", monospace';
    ctx.fillStyle = COLOR_P1;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur = 24;
    ctx.fillText(winnerLabel, CANVAS_WIDTH / 2, 150);

    // Score
    ctx.font = '28px "Courier New", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.fillText(`${score1}  —  ${score2}`, CANVAS_WIDTH / 2, 210);

    // Stats
    ctx.font = '18px "Courier New", monospace';
    ctx.fillStyle = 'rgba(200,200,255,0.7)';
    ctx.fillText(`Longest Rally: ${longestRally}`, CANVAS_WIDTH / 2, 260);
    ctx.fillStyle = COLOR_SPARK;
    ctx.shadowColor = COLOR_SPARK;
    ctx.shadowBlur = 8;
    ctx.fillText(`⚡ +${sparksEarned}  Neon Sparks`, CANVAS_WIDTH / 2, 295);

    ctx.restore();

    const options = ['Upgrade Shop', 'Rematch', 'Main Menu'];
    this.drawCenteredMenu('', options, selectedIndex, 340);
  }

  // ─── Pause overlay ──────────────────────────────────────────────────────

  drawPauseOverlay(selectedIndex: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(5, 5, 30, 0.72)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();

    this.drawCenteredMenu('PAUSED', ['Resume', 'Upgrade Shop', 'Quit to Menu'], selectedIndex);
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

  // ─── Helpers ────────────────────────────────────────────────────────────

  private drawCenteredMenu(
    title: string,
    options: string[],
    selectedIndex: number,
    startY = 220
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';

    if (title) {
      ctx.font = 'bold 32px "Courier New", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = COLOR_P1;
      ctx.shadowBlur = 14;
      ctx.fillText(title, CANVAS_WIDTH / 2, startY - 40);
    }

    options.forEach((label, i) => {
      const y = startY + i * 50;
      const isSelected = i === selectedIndex;
      ctx.font = `${isSelected ? 'bold ' : ''}24px "Courier New", monospace`;
      ctx.fillStyle = isSelected ? COLOR_P1 : 'rgba(200,200,255,0.5)';
      ctx.shadowColor = isSelected ? COLOR_P1 : 'transparent';
      ctx.shadowBlur = isSelected ? 14 : 0;
      ctx.fillText((isSelected ? '▸  ' : '   ') + label, CANVAS_WIDTH / 2, y);
    });

    ctx.restore();
  }
}
