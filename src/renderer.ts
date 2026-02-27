// Renderer — all canvas drawing; pure output, no state mutation

import { Ball, Paddle, ImpactRing, WallMark, GameState, GamePhase } from './types.js';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  COLOR_BG, COLOR_P1, COLOR_P2, COLOR_BALL, COLOR_COURT, COLOR_SPARK,
  GLOW_PADDLE, GLOW_BALL, GLOW_RING,
  TRAIL_LENGTH,
  SQUASH_DURATION_MS, STRETCH_DURATION_MS, SQUASH_AMOUNT, STRETCH_AMOUNT,
  BREATH_AMP_PX,
  CHROMATIC_OFFSET,
  RING_MAX_RADIUS, RING_DURATION_MS,
  WALL_MARK_FADE_MS,
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
    this.drawBallTrail(state.ball);
    this.drawBall(state.ball);
    this.drawPaddle(state.player1);
    this.drawPaddle(state.player2);
    this.drawImpactRings(state.impactRings);

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
    this.drawBallTrail(state.ball);
    this.drawBall(state.ball);
    this.drawPaddle(state.player1);
    this.drawImpactRings(state.impactRings);

    ctx.restore();

    this.drawToyHints(state.player1);
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

    if (ball.squashTimer > 0) {
      // Squash: flatten in travel direction, expand perpendicular
      const t = ball.squashTimer / SQUASH_DURATION_MS;
      const s = 1 + (SQUASH_AMOUNT - 1) * t;
      scaleX = s;       // elongated perpendicular (local Y after rotation)
      scaleY = 1 / s;   // flattened in travel direction
    } else if (ball.stretchTimer > 0) {
      // Stretch: elongate in travel direction
      const t = ball.stretchTimer / STRETCH_DURATION_MS;
      const s = 1 + (STRETCH_AMOUNT - 1) * t;
      scaleX = 1 / s;   // narrow perp
      scaleY = s;        // elongated in travel
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

    // Spin indicator lines (subtle rotation marks)
    if (Math.abs(ball.spin) > 0.02) {
      this.drawSpinLines(ball, angle);
    }
  }

  private drawSpinLines(ball: Ball, angle: number): void {
    const { ctx } = this;
    const spinIntensity = Math.min(Math.abs(ball.spin) / 0.15, 1);
    const numLines = 2;
    const lineLen = ball.radius * 0.9;

    ctx.save();
    ctx.globalAlpha = 0.5 * spinIntensity;
    ctx.strokeStyle = COLOR_BALL;
    ctx.lineWidth = 1;
    ctx.translate(ball.x, ball.y);

    for (let i = 0; i < numLines; i++) {
      const baseAngle = (i / numLines) * Math.PI + (Date.now() * 0.003 * Math.sign(ball.spin));
      ctx.beginPath();
      ctx.moveTo(
        Math.cos(baseAngle) * (ball.radius - lineLen),
        Math.sin(baseAngle) * (ball.radius - lineLen)
      );
      ctx.lineTo(
        Math.cos(baseAngle) * ball.radius,
        Math.sin(baseAngle) * ball.radius
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Paddle ─────────────────────────────────────────────────────────────

  drawPaddle(paddle: Paddle): void {
    const { ctx } = this;
    const color = paddle.id === 1 ? COLOR_P1 : COLOR_P2;

    const px = paddle.x + paddle.recoilOffset;
    const py = paddle.y + paddle.emotionOffset;
    const pw = paddle.width;
    // Subtle breathing: oscillate height slightly
    const breath = Math.sin(paddle.breathPhase) * BREATH_AMP_PX;
    const ph = paddle.height + breath;
    const pyAdj = py - breath / 2; // keep center stable

    // Chromatic aberration flash
    if (paddle.chromaticTimer > 0) {
      const t = paddle.chromaticTimer / 50; // normalized 0→1
      const off = CHROMATIC_OFFSET * t;

      ctx.save();
      ctx.globalAlpha = 0.45 * t;
      // Red channel
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(px - off, pyAdj, pw, ph);
      // Blue channel
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(px + off, pyAdj, pw, ph);
      ctx.restore();
    }

    // Glow halo
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = GLOW_PADDLE * 1.5;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(px - 2, pyAdj - 2, pw + 4, ph + 4);
    ctx.restore();

    // Main paddle body
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = GLOW_PADDLE;
    ctx.fillStyle = color;
    ctx.fillRect(px, pyAdj, pw, ph);
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

  // ─── Toy-mode control hints ─────────────────────────────────────────────

  private drawToyHints(paddle: Paddle): void {
    const { ctx } = this;
    const x = paddle.x + paddle.width + 18;
    const midY = paddle.y + paddle.height / 2;

    ctx.save();
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.textAlign = 'left';
    ctx.fillText('W / ↑', x, midY - 10);
    ctx.fillText('S / ↓', x, midY + 18);
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
