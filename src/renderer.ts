/**
 * @file renderer.ts
 * @description Renderer — all canvas drawing for Neon Pong.
 *
 * DESIGN PHILOSOPHY — PURE OUTPUT
 * --------------------------------
 * The Renderer class contains ONLY drawing code.  It reads GameState and
 * writes pixels to the canvas.  It never mutates any game state (with the
 * small exception of temporarily scaling ball.radius for the serve pulse
 * animation, which it restores immediately after drawing).
 *
 * This separation makes the renderer easy to reason about: if something
 * looks wrong on screen, the bug is in this file (or the state fed into it).
 *
 * COORDINATE SYSTEM
 * -----------------
 * The canvas drawing buffer is always 960 × 540 logical pixels.
 * On high-DPI (Retina) displays, the constructor multiplies that by the
 * devicePixelRatio so every physical pixel gets its own sample — no blur.
 * All drawing code uses the original 960 × 540 logical coordinates.
 *
 * LAYER ORDER (bottom to top each frame)
 * ----------------------------------------
 *   1. Background (+ warm tint at high rally)
 *   2. Wall scorch marks
 *   3. Court lines + center circle
 *   4. Wall boundary bars (top/bottom)
 *   5. Goal particles
 *   6. Power-up orbs
 *   7. Ball trail
 *   8. Ball
 *   9. Paddles
 *  10. Impact rings
 *  11. Goal flash (half-court overlay)
 *  12. Speed lines (Dramatic+ tier)
 *  13. HUD (scores, pips, rally label, boost icons)
 *  14. Screen-edge pulse (Legendary tier)
 */

import
{
  Ball, Paddle, ImpactRing, WallMark, GoalFlash, GoalParticle,
  GameState, PowerUp, ActiveBoost, PowerUpType
} from './types.js';
import
{
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
  BALL_BASE_SPEED, BALL_MAX_SPEED,
  CHROMATIC_MS,
} from './constants.js';

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE-LEVEL HELPER FUNCTIONS
   Pure functions used by the Renderer but not part of its public API.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function trailDisplayCount
 * @description Returns how many trail points to render for the given rally count.
 *              The trail grows longer as the rally intensifies, adding visual weight.
 *
 * @param rallyCount  Current consecutive hit count.
 * @returns {number} Number of trail positions to display.
 */
function trailDisplayCount(rallyCount: number): number
{
  if (rallyCount >= RALLY_TIER_LEGENDARY) return 22;
  if (rallyCount >= RALLY_TIER_DRAMATIC)  return 18;
  if (rallyCount >= RALLY_TIER_INTENSE)   return 14;
  if (rallyCount >= RALLY_TIER_BUILDING)  return 12;
  return 10;
}

/**
 * @function rallyZoom
 * @description Returns the extra canvas scale factor (0 = no zoom) for the
 *              subtle "TV camera push-in" effect at intense rally counts.
 *              Values are additive on top of 1.0 (e.g. 0.010 → 1.010× scale).
 *
 * @param rallyCount  Current consecutive hit count.
 * @returns {number} Extra scale delta (0 at low rally, up to ZOOM_LEGENDARY).
 */
function rallyZoom(rallyCount: number): number
{
  if (rallyCount >= RALLY_TIER_LEGENDARY) return ZOOM_LEGENDARY;
  if (rallyCount >= RALLY_TIER_DRAMATIC)  return ZOOM_DRAMATIC;
  if (rallyCount >= RALLY_TIER_INTENSE)   return ZOOM_INTENSE;
  return 0;
}

/**
 * @function getRallyLabel
 * @description Returns an escalating emoji-decorated rally counter label.
 *              Returns empty string when the rally is too low to display.
 *
 * @param count  Current rally hit count.
 * @returns {string} Label text, e.g. "🔥 12 🔥" or "".
 */
function getRallyLabel(count: number): string
{
  if (count <  4)  return '';
  if (count >= 25) return `🌟 ${count} 🌟`;
  if (count >= 20) return `💥 ${count} 💥`;
  if (count >= 15) return `⚡ ${count} ⚡`;
  if (count >= 10) return `🔥 ${count} 🔥`;
  if (count >=  7) return `🏓 ${count} 🏓`;
  return                  `🏓 ${count}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENDERER CLASS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @class Renderer
 * @description Owns the canvas 2D context and draws every frame.
 *
 * The Game class creates one Renderer and calls draw() each frame during
 * all phases except DIFFICULTY_SELECT (when the HTML overlay is visible).
 */
export class Renderer
{
  /** The 2D rendering context — all drawing happens through this object. */
  private ctx: CanvasRenderingContext2D;

  /** Full viewport dimensions (CSS pixels), used to fill background edge-to-edge. */
  private vpW: number;
  private vpH: number;

  /** Transform that centers and scales the 960×540 game area within the viewport. */
  private gameOffX: number;
  private gameOffY: number;
  private gameScale: number;

  /**
   * Game-time clock in ms (set to the gameTime parameter at the start of each
   * draw() call).  Used for all animation oscillations instead of this.t so
   * pulses are frame-rate-independent and anchored to match start — no jump when
   * a background tab returns to focus.
   */
  private t: number = 0;

  /* ── Constructor ─────────────────────────────────────────────────────── */

  /**
   * @constructor
   * @description Sets up the canvas drawing buffer for the display's pixel density.
   *
   *              On a Retina (2× DPR) display, the logical canvas is 960×540 but
   *              the actual pixel buffer is 1920×1080.  We scale the context by DPR
   *              once here so all drawing code can still use 960×540 coordinates.
   *
   * @param canvas  The <canvas> element from the DOM.
   * @throws {Error} If the browser doesn't support a 2D context.
   */
  constructor(canvas: HTMLCanvasElement)
  {
    /* CANVAS_WIDTH was set by setCanvasWidth() before this constructor runs,
       so game coords exactly match the viewport aspect ratio.              */
    const dpr = window.devicePixelRatio || 1;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;

    canvas.width  = vw * dpr;
    canvas.height = vh * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    ctx.scale(dpr, dpr);

    /* Because CANVAS_WIDTH = CANVAS_HEIGHT * (vw/vh), the scale is uniform
       and both offsets are ≈ 0 — game fills viewport with no bars.        */
    const scale   = Math.min(vw / CANVAS_WIDTH, vh / CANVAS_HEIGHT);
    this.vpW      = vw;
    this.vpH      = vh;
    this.gameOffX = (vw - CANVAS_WIDTH  * scale) / 2;
    this.gameOffY = (vh - CANVAS_HEIGHT * scale) / 2;
    this.gameScale  = scale;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TOP-LEVEL DRAW
     Called once per frame. Orchestrates all layer drawing.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method draw
   * @description Draws one complete frame of gameplay.
   *
   *              The rendering is structured as a series of ctx.save() / ctx.restore()
   *              pairs, each adding a transform layer:
   *                - Zoom layer   (subtle canvas scale for rally tension)
   *                - Shake layer  (random offset for camera shake)
   *                - HUD          (drawn outside shake so it stays stable)
   *                - Edge pulse   (drawn outside zoom so it hits true screen edges)
   *
   * @param state    Complete current game state.
   * @param shakeX   Horizontal camera shake offset (px) from getShakeOffset().
   * @param shakeY   Vertical camera shake offset (px).
   * @param gameTime Milliseconds elapsed since match start (for boost expiry display).
   * @param godMode  If true, P1 always shows all active boosts.
   * @param goatMode If true, P1 paddle renders in gold GOAT style.
   */
  draw(
    state: GameState,
    shakeX: number,
    shakeY: number,
    gameTime = 0,
    godMode  = false,
    goatMode = false
  ): void
  {
    const { ctx } = this;
    const rc = state.rallyCount;

    /* Snapshot game time for all oscillation math this frame. */
    this.t = gameTime;

    /* ── Background warmth (computed once, used for both fills) ──────────
       Warms subtly toward red at Dramatic+ (subliminal tension).         */
    const warmth = rc >= RALLY_TIER_DRAMATIC
      ? Math.min((rc - RALLY_TIER_DRAMATIC) / 12, 1)
      : 0;

    /* ── Full-viewport background fill ───────────────────────────────────
       Paint the entire canvas (including any area outside the 960×540
       game zone) before applying the game transform.  This eliminates
       all side / top / bottom bars regardless of viewport aspect ratio.  */
    const bgR = Math.round(10 + warmth * 5);
    ctx.fillStyle = `rgb(${bgR},10,46)`;
    ctx.fillRect(0, 0, this.vpW, this.vpH);

    /* ── Game area transform ─────────────────────────────────────────────
       All game content is drawn in 960×540 logical coordinates.
       This transform centers and scales that space into the full viewport. */
    ctx.save(); // GAME TRANSFORM
    ctx.translate(this.gameOffX, this.gameOffY);
    ctx.scale(this.gameScale, this.gameScale);

    /* ── Rally zoom ─────────────────────────────────────────────────────
       Subtle "TV camera push-in" centered on canvas midpoint.
       Zoom value is extra scale on top of 1.0 (e.g. 0.025 → 1.025×).  */
    const zoom = rallyZoom(rc);
    ctx.save(); // ZOOM LAYER
    if (zoom > 0)
    {
      ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.scale(1 + zoom, 1 + zoom);
      ctx.translate(-CANVAS_WIDTH / 2, -CANVAS_HEIGHT / 2);
    }

    /* ── Screen shake ── */
    ctx.save(); // SHAKE LAYER
    ctx.translate(shakeX, shakeY);

    /* ── Background (game area) ── */
    this.drawBackground(warmth);
    this.drawWallMarks(state.wallMarks);

    /* ── Court + walls ──────────────────────────────────────────────────
       Court lines use the difficulty theme color and brighten with rally
       intensity.                                                        */
    const courtIntensity = 1 + Math.min(rc / RALLY_TIER_LEGENDARY, 1) * 1.8;
    const courtColor =
      state.difficulty === 'HARD' ? COLOR_P2 :
      state.difficulty === 'EASY' ? '#44ff88' :
      COLOR_P1;
    this.drawCourt(courtIntensity, courtColor);
    this.drawWallBoundaries(courtIntensity, courtColor);

    /* ── Particles + power-up orbs ── */
    this.drawGoalParticles(state.goalParticles);
    this.drawPowerUps(state.powerUps);

    /* ── Ball trail ─────────────────────────────────────────────────────
       Trail blazer boost or god mode extends and brightens the trail.  */
    const trailBlazer = state.activeBoosts.some(b => b.type === 'TRAIL_BLAZER') || godMode;
    this.drawBallTrail(state.ball, rc, trailBlazer);

    /* ── Compute active boost flags for paddle rendering ── */
    const p1SpeedBoost = godMode || state.activeBoosts.some(b => b.owner === 1 && b.type === 'SPEED_BOOTS');
    const p2SpeedBoost = state.activeBoosts.some(b => b.owner === 2 && b.type === 'SPEED_BOOTS');
    const p1WidePaddle = godMode || state.activeBoosts.some(b => b.owner === 1 && b.type === 'WIDE_PADDLE');
    const p2WidePaddle = state.activeBoosts.some(b => b.owner === 2 && b.type === 'WIDE_PADDLE');

    /* ── Ball ───────────────────────────────────────────────────────────
       During POINT_SCORED:  ball fades in (materializeAlpha 0→1).
       During SERVE_PENDING / SERVING: ball gently pulses.               */
    const isMaterialize = state.materializeAlpha < 0.99;
    const isPulsing     = state.phase === 'SERVE_PENDING' || state.phase === 'SERVING';

    if (isMaterialize || isPulsing)
    {
      ctx.save();
      if (isMaterialize) ctx.globalAlpha = state.materializeAlpha;
      if (isPulsing)
      {
        /* Gentle size pulse using sin — purely cosmetic, doesn't affect collision. */
        const pulse = 1 + Math.sin(this.t * 0.006) * 0.07;
        const orig  = state.ball.radius;
        state.ball.radius = orig * pulse;
        this.drawBall(state.ball);
        state.ball.radius = orig; // restore immediately
      }
      else
      {
        this.drawBall(state.ball);
      }
      ctx.restore();
    }
    else
    {
      this.drawBall(state.ball);
    }

    /* ── Sticky paddle rings (while ball is held) ── */
    if (state.ball.stickyHoldMs > 0 && state.ball.stickyOwner !== null)
    {
      const holdingPaddle = state.ball.stickyOwner === 1 ? state.player1 : state.player2;
      this.drawStickyPaddleEffect(holdingPaddle, state.ball.stickyHoldMs);
    }

    this.drawPaddle(state.player1, p1SpeedBoost, p1WidePaddle, goatMode);
    this.drawPaddle(state.player2, p2SpeedBoost, p2WidePaddle);
    this.drawImpactRings(state.impactRings);
    this.drawGoalFlashes(state.goalFlashes);

    /* ── Speed lines — appear at Dramatic tier only ── */
    if (rc >= RALLY_TIER_DRAMATIC)
    {
      this.drawSpeedLines(state.ball, rc);
    }

    ctx.restore(); // END SHAKE LAYER

    /* ── HUD — drawn outside shake so it stays stable on screen ── */
    this.drawHUD(state, gameTime, godMode);

    ctx.restore(); // END ZOOM LAYER

    /* ── Screen-edge pulse — drawn outside zoom to hit true canvas edges ── */
    if (rc >= RALLY_TIER_LEGENDARY)
    {
      this.drawEdgePulse(rc);
    }

    ctx.restore(); // END GAME TRANSFORM
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BACKGROUND
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawBackground
   * @description Fills the canvas with the game background color.
   *              At high rally counts the red channel is nudged slightly
   *              warmer (#0a0a2e → #0f0a2e) for subliminal tension.
   *
   * @param warmth  0 = cool base color; 1 = maximum warmth shift.
   */
  private drawBackground(warmth = 0): void
  {
    const { ctx } = this;
    /* Base: r=10, g=10, b=46.  At full warmth: r=15. */
    const r = Math.round(10 + warmth * 5);
    ctx.fillStyle = `rgb(${r},10,46)`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COURT LINES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawCourt
   * @description Draws the dashed center line and center circle.
   *              Both brighten as intensity scales above 1 to signal rising tension.
   *
   * @param intensity    1 = normal; higher = brighter lines and stronger glow.
   * @param courtColor   Hex color string — driven by the current difficulty.
   */
  private drawCourt(intensity = 1, courtColor = COLOR_P1): void
  {
    const { ctx } = this;
    const alpha = Math.min(0.30 * intensity, 0.72);

    /* ── Dashed center line ── */
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = courtColor;
    ctx.shadowColor = courtColor;
    ctx.shadowBlur  = 5 + (intensity > 1.5 ? (intensity - 1) * 16 : 0);
    ctx.lineWidth   = 2;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* ── Center circle ── */
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = courtColor;
    ctx.shadowColor = courtColor;
    ctx.shadowBlur  = 5 + (intensity > 1.5 ? (intensity - 1) * 10 : 0);
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WALL SCORCH MARKS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawWallMarks
   * @description Draws fading scorch marks at the positions where the ball
   *              hit the top/bottom walls.  Each mark fades over WALL_MARK_FADE_MS.
   *
   * @param marks  Array of active WallMark objects.
   */
  private drawWallMarks(marks: WallMark[]): void
  {
    const { ctx } = this;
    for (const mark of marks)
    {
      const alpha = Math.max(0, 1 - mark.age / WALL_MARK_FADE_MS);
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle   = COLOR_P1;
      ctx.shadowColor = COLOR_P1;
      ctx.shadowBlur  = 4;
      ctx.beginPath();
      ctx.ellipse(mark.x, mark.y, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BALL TRAIL
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawBallTrail
   * @description Draws the motion trail — a series of fading circles tracing
   *              the ball's recent path.  Newest at index 0, oldest at end.
   *              The trail grows longer and brighter at high rally counts.
   *
   * @param ball         The ball (trail is read from ball.trail).
   * @param rallyCount   Current consecutive hit count.
   * @param trailBlazer  true = TRAIL_BLAZER boost active (trail is longer and brighter).
   */
  private drawBallTrail(ball: Ball, rallyCount = 0, trailBlazer = false): void
  {
    const { ctx } = this;

    /* TRAIL_BLAZER doubles the display length. */
    const blazeMult  = trailBlazer ? 2 : 1;
    const rawLen     = trailDisplayCount(rallyCount) * blazeMult;
    const displayLen = Math.min(ball.trail.length, rawLen);
    if (displayLen === 0) return;

    /* Base brightness increases with intensity (more visible at high rally). */
    const intensity =
      rallyCount >= RALLY_TIER_LEGENDARY ? 1    :
      rallyCount >= RALLY_TIER_DRAMATIC  ? 0.75 :
      rallyCount >= RALLY_TIER_INTENSE   ? 0.5  : 0;

    const baseAlpha = (0.55 + intensity * 0.25) * (trailBlazer ? 1.4 : 1);

    for (let i = 0; i < displayLen; i++)
    {
      const pt  = ball.trail[i];

      /* age 0 = newest (full alpha), age 1 = oldest (zero alpha). */
      const age    = (i + 1) / (displayLen + 1);
      const alpha  = (1 - age) * baseAlpha;
      const radius = ball.radius * (1 - age * 0.6);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = COLOR_P1;
      ctx.shadowColor = COLOR_P1;
      ctx.shadowBlur  = (8 + intensity * 8) * (1 - age);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BALL
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawBall
   * @description Draws the ball with squash/stretch deformation, neon glow,
   *              hit-flash, face expression (eye + mouth), and spin indicators.
   *
   * COORDINATE TRICK:
   *   We rotate the canvas to align with the ball's travel direction, then
   *   scale to produce squash/stretch deformation along that axis.
   *   After drawing the core, we restore to world-space to draw the face
   *   (which should always be upright, not rotated with travel direction).
   *
   * @param ball  The ball to draw.
   */
  private drawBall(ball: Ball): void
  {
    const { ctx } = this;

    /* Travel direction angle — used for squash/stretch axis alignment. */
    const angle = Math.atan2(ball.vy, ball.vx);

    /* ── Compute squash / stretch deformation scales ─────────────────────
       scaleX = along travel direction (local X after rotation).
       scaleY = perpendicular to travel (local Y).
       At rest: both = 1.  Squash: X compressed, Y expanded.  Stretch: opposite. */
    let scaleX = 1;
    let scaleY = 1;

    if (ball.squashTimer > 0)
    {
      /* Squash against paddle face: compress travel axis, expand perpendicular. */
      const t = ball.squashTimer / SQUASH_DURATION_MS;
      const s = 1 + (SQUASH_AMOUNT - 1) * t; // < 1 at peak squash
      scaleX = s;
      scaleY = 1 / s;
    }
    else if (ball.stretchTimer > 0)
    {
      /* Stretch in travel direction: elongate travel axis, narrow perpendicular. */
      const t = ball.stretchTimer / STRETCH_DURATION_MS;
      const s = 1 + (STRETCH_AMOUNT - 1) * t; // > 1 at peak stretch
      scaleX = s;
      scaleY = 1 / s;
    }

    /* ── Outer glow halo ── */
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(angle);
    ctx.scale(scaleX, scaleY);
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur  = GLOW_BALL;
    ctx.fillStyle   = COLOR_P1;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* ── White-hot core ── */
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(angle);
    ctx.scale(scaleX, scaleY);
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur  = GLOW_BALL;
    ctx.fillStyle   = COLOR_BALL;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* ── Hit flash: yellow-orange tint that fades out ── */
    if (ball.hitFlashTimer > 0)
    {
      const flashT = ball.hitFlashTimer / HIT_EYE_FLASH_MS;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(angle);
      ctx.scale(scaleX, scaleY);
      ctx.globalAlpha = flashT * 0.85;
      ctx.fillStyle   = COLOR_SPARK;
      ctx.shadowColor = COLOR_SPARK;
      ctx.shadowBlur  = 18 * flashT;
      ctx.beginPath();
      ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ── Ball face (eye + mouth) — world space, no travel-direction rotation ── */
    ctx.save();
    ctx.translate(ball.x, ball.y);
    this.drawBallEye(ball);
    this.drawBallMouth(ball);
    ctx.restore();

    /* ── Spin indicator lines ── */
    if (Math.abs(ball.spin) > 0.02)
    {
      this.drawSpinLines(ball, angle);
    }

    /* ── Sticky hold visual (magenta corona + depleting arc) ── */
    if (ball.stickyHoldMs > 0)
    {
      this.drawStickyBallEffect(ball);
    }
  }

  /**
   * @method drawBallEye
   * @description Draws the ball's eye in world space (origin = ball center, no rotation).
   *              The eye position mirrors horizontally with the ball's travel direction
   *              so it always faces forward.
   *
   *              Three modes:
   *                - Normal:    filled black circle with specular highlight.
   *                - Happy squint (speed > ~70%): ∩ arc (narrowed eye).
   *                - Sad:       smaller radius (0.8×) during BALL_SAD_MS.
   *
   * @param ball  The ball; eye position derived from ball.radius and ball.vx/vy.
   */
  private drawBallEye(ball: Ball): void
  {
    const { ctx } = this;
    const r      = ball.radius;

    /* speedT: 0 at base speed, 1 at max speed — drives squint expression. */
    const speedT = Math.max(0, Math.min((ball.speed - BALL_BASE_SPEED) / (BALL_MAX_SPEED - BALL_BASE_SPEED), 1));

    /* Eye position: slightly forward (in direction of vx), upper half of ball. */
    const dirX = ball.vx >= 0 ? 1 : -1;
    const eyeX = r * 0.15 * dirX;
    const eyeY = -r * 0.35; // above center

    /* Eye radius with reactions: wider on hit, smaller when sad. */
    let eyeR = r * 0.30;
    if (ball.hitFlashTimer > 0)
    {
      const flashT = ball.hitFlashTimer / HIT_EYE_FLASH_MS;
      eyeR *= 1 + 0.3 * flashT; // up to 1.3× on hit
    }
    else if (ball.sadTimer > 0)
    {
      eyeR *= 0.8; // 0.8× when sad
    }

    ctx.save();
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap     = 'round';

    if (speedT > 0.65)
    {
      /* Happy squint: ∩ arc (curved upward like a closed-eye smile). */
      ctx.strokeStyle = '#000000';
      ctx.lineWidth   = eyeR * 0.90;
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeR * 0.75, Math.PI + 0.5, 2 * Math.PI - 0.5);
      ctx.stroke();
    }
    else
    {
      /* Normal filled eye. */
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();

      /* Specular highlight — small white dot at the "10 o'clock" position. */
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

  /**
   * @method drawBallMouth
   * @description Draws the ball's mouth in world space.
   *              Normal state: smile (∪ arc).
   *              Sad state: frown (∩ arc) during BALL_SAD_MS after a goal.
   *
   * @param ball  The ball; mouth position derived from ball.radius and ball.vx.
   */
  private drawBallMouth(ball: Ball): void
  {
    const { ctx } = this;
    const r      = ball.radius;
    const dirX   = ball.vx >= 0 ? 1 : -1;

    /* Mouth sits in the lower-forward quadrant of the ball face. */
    const mouthX = r * 0.70 * dirX;
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

    /* arcY: shift the arc center up when frowning so both smile and frown
       appear in the lower half of the face.                               */
    const arcY = sad ? mouthY - mouthR * 0.6 : mouthY;

    /* arc(cx, cy, r, startAngle, endAngle, anticlockwise)
       false (default) = clockwise = ∪ smile
       true            = counterclockwise = ∩ frown                       */
    ctx.arc(mouthX, arcY, mouthR, 0, Math.PI, sad);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * @method drawSpinLines
   * @description Draws three rotating radial lines inside the ball to indicate
   *              that spin is active.  The lines rotate with ball.spinAngle,
   *              which accumulates proportional to spin magnitude so they slow
   *              naturally as spin decays.
   *
   * @param ball   The ball.
   * @param angle  Travel direction angle (radians) — used for context rotation.
   */
  private drawSpinLines(ball: Ball, angle: number): void
  {
    const { ctx } = this;

    /* Normalize spin to [0,1] — full visual intensity at |spin| ≈ 0.15. */
    const spinIntensity = Math.min(Math.abs(ball.spin) / 0.15, 1);
    const numLines = 3;
    const innerR   = ball.radius * 0.25;
    const outerR   = ball.radius * 0.95;

    ctx.save();
    ctx.globalAlpha = 0.65 * spinIntensity;
    ctx.strokeStyle = COLOR_BALL;
    ctx.lineWidth   = 1.5;
    ctx.translate(ball.x, ball.y);

    for (let i = 0; i < numLines; i++)
    {
      /* Distribute lines evenly around the circle, offset by spinAngle. */
      const baseAngle = (i / numLines) * Math.PI * 2 + ball.spinAngle;
      ctx.beginPath();
      ctx.moveTo(Math.cos(baseAngle) * innerR, Math.sin(baseAngle) * innerR);
      ctx.lineTo(Math.cos(baseAngle) * outerR, Math.sin(baseAngle) * outerR);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     GOAL FLASH
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawGoalFlashes
   * @description Draws a brief white flash covering one half of the court
   *              immediately after a goal.
   *
   *              Flash profile: holds at 20% alpha for the first 25% of its
   *              lifetime (≈ 2 frames), then fades to 0 over the remainder.
   *
   *              side 1 = right half flashes (P1 scored).
   *              side 2 = left  half flashes (P2 scored).
   *
   * @param flashes  Array of active GoalFlash objects.
   */
  private drawGoalFlashes(flashes: GoalFlash[]): void
  {
    const { ctx } = this;
    for (const flash of flashes)
    {
      const t = flash.age / GOAL_FLASH_MS;

      /* Hold phase: first 25% at full alpha; fade phase: next 75%. */
      const alpha = t < 0.25
        ? 0.20
        : 0.20 * (1 - (t - 0.25) / 0.75);

      /* Left edge of the half to flash. */
      const x = flash.side === 1 ? CANVAS_WIDTH / 2 : 0;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(x, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     GOAL PARTICLES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawGoalParticles
   * @description Draws the burst of particles that scatter from the goal line
   *              when a point is scored.  Each particle fades out over its lifetime.
   *
   * @param particles  Array of active GoalParticle objects.
   */
  private drawGoalParticles(particles: GoalParticle[]): void
  {
    const { ctx } = this;
    for (const p of particles)
    {
      const alpha = Math.max(0, 1 - p.age / GOAL_PARTICLE_MS);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PADDLE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawPaddle
   * @description Draws one paddle with its full suite of visual effects:
   *   - Base color (cyan for P1, magenta for P2)
   *   - Color-flash: blue → orange → blue on hit (tent curve)
   *   - Chromatic aberration: R/B channel split on hit
   *   - Glow halo that blooms brighter during the color flash
   *   - Breathing oscillation (subtle height pulse)
   *   - WIDE_PADDLE: glowing green end-caps at extended edges
   *   - SPEED_BOOTS: velocity streaks from the leading edge
   *
   * @param paddle      The Paddle to draw.
   * @param speedBoost  true = SPEED_BOOTS boost active.
   * @param widePaddle  true = WIDE_PADDLE boost active.
   */
  drawPaddle(paddle: Paddle, speedBoost = false, widePaddle = false, goatMode = false): void
  {
    const { ctx } = this;
    /* GOAT mode gives P1 a slowly cycling gold color instead of cyan. */
    const baseColor = goatMode && paddle.id === 1
      ? `hsl(${45 + Math.sin(this.t * 0.002) * 12}, 100%, 60%)`
      : paddle.id === 1 ? COLOR_P1 : COLOR_P2;

    /* ── Color flash: lerp base → orange → base over PADDLE_COLOR_FLASH_MS ──
       Uses sin(t * π) as the intensity curve.  When t=1 (start of flash)
       the sin value is 0; it peaks at sin(π/2)=1 at the midpoint, then
       returns to 0.  This creates a smooth blue → orange → blue arc.     */
    let color = baseColor;
    if (paddle.colorFlashTimer > 0)
    {
      const t         = paddle.colorFlashTimer / PADDLE_COLOR_FLASH_MS; // 1 → 0
      const intensity = Math.sin(t * Math.PI);
      color           = this.lerpColor(baseColor, COLOR_HIT_FLASH, intensity);
    }

    /* ── Final draw positions with all offsets applied ── */
    const px     = paddle.x + paddle.recoilOffset;
    const py     = paddle.y + paddle.emotionOffset;
    const pw     = paddle.width;

    /* Breathing oscillation — very subtle height change to feel "alive". */
    const breath = Math.sin(paddle.breathPhase) * BREATH_AMP_PX;
    const ph     = paddle.height + breath;
    const pyAdj  = py - breath / 2; // keep vertical center stable during breathing

    /* ── Chromatic aberration flash ────────────────────────────────────
       Splits the paddle into red and blue offset copies for a brief RGB-
       split glitch effect on contact.                                   */
    if (paddle.chromaticTimer > 0)
    {
      const t   = paddle.chromaticTimer / CHROMATIC_MS;
      const off = CHROMATIC_OFFSET * t;

      ctx.save();
      ctx.globalAlpha = 0.45 * t;
      ctx.fillStyle   = '#ff0000';
      ctx.fillRect(px - off, pyAdj, pw, ph);
      ctx.fillStyle   = '#0000ff';
      ctx.fillRect(px + off, pyAdj, pw, ph);
      ctx.restore();
    }

    /* ── Glow halo — blooms during color flash ── */
    const flashBoost = paddle.colorFlashTimer > 0
      ? Math.sin((paddle.colorFlashTimer / PADDLE_COLOR_FLASH_MS) * Math.PI)
      : 0;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = GLOW_PADDLE * 1.5 + flashBoost * 24;
    ctx.fillStyle   = color;
    ctx.globalAlpha = 0.25 + flashBoost * 0.35;
    ctx.fillRect(px - 2, pyAdj - 2, pw + 4, ph + 4);
    ctx.restore();

    /* ── GOAT mode outer aura ── */
    if (goatMode)
    {
      const goatPulse = 0.5 + 0.5 * Math.abs(Math.sin(this.t * 0.003));
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur  = 40 + goatPulse * 24;
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.08 + goatPulse * 0.07;
      ctx.fillRect(px - 6, pyAdj - 6, pw + 12, ph + 12);
      ctx.restore();
    }

    /* ── Main paddle body ── */
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = GLOW_PADDLE + flashBoost * 12;
    ctx.fillStyle   = color;
    ctx.fillRect(px, pyAdj, pw, ph);
    ctx.restore();

    /* ── WIDE_PADDLE end-cap accents ────────────────────────────────────
       Green glowing horizontal bars at the top and bottom edges of the
       extended paddle, pulsing slowly to draw attention.               */
    if (widePaddle)
    {
      ctx.save();
      ctx.strokeStyle = COLOR_POWERUP_WIDE;
      ctx.shadowColor = COLOR_POWERUP_WIDE;
      ctx.shadowBlur  = 10;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.t * 0.004);

      /* Top cap. */
      ctx.beginPath();
      ctx.moveTo(px - 3, pyAdj);
      ctx.lineTo(px + pw + 3, pyAdj);
      ctx.stroke();

      /* Bottom cap. */
      ctx.beginPath();
      ctx.moveTo(px - 3, pyAdj + ph);
      ctx.lineTo(px + pw + 3, pyAdj + ph);
      ctx.stroke();

      ctx.restore();
    }

    /* ── SPEED_BOOTS velocity streaks ────────────────────────────────────
       Four vertical lines shoot from the leading edge of the paddle
       (top edge when moving up, bottom when moving down).
       Length and brightness scale with speed fraction.                 */
    if (speedBoost)
    {
      const speedFrac = Math.min(Math.abs(paddle.vy) / (PADDLE_BASE_SPEED * 0.8), 1);
      if (speedFrac > 0.15)
      {
        const dir   = paddle.vy > 0 ? 1 : -1;
        const edgeY = dir > 0 ? pyAdj + ph : pyAdj; // leading edge Y

        ctx.save();
        ctx.strokeStyle = COLOR_POWERUP_SPEED;
        ctx.shadowColor = COLOR_POWERUP_SPEED;
        ctx.shadowBlur  = 8;
        ctx.lineCap     = 'round';

        for (let i = 0; i < 4; i++)
        {
          const xFrac     = (i + 0.5) / 4;
          const streakLen = speedFrac * 18 * (0.6 + 0.4 * Math.sin(this.t * 0.01 + i));
          ctx.globalAlpha = speedFrac * (0.75 - i * 0.15);
          ctx.lineWidth   = 1.8 - i * 0.3;
          ctx.beginPath();
          ctx.moveTo(px + pw * xFrac, edgeY);
          ctx.lineTo(px + pw * xFrac, edgeY + dir * streakLen);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /**
   * @method lerpColor
   * @description Linearly interpolates between two hex color strings.
   *              t=0 returns c1; t=1 returns c2.  Used for the paddle color flash.
   *
   * @param c1  Starting color (e.g. '#00f0ff').
   * @param c2  Ending color   (e.g. '#ff6600').
   * @param t   Blend factor 0–1.
   * @returns {string} Interpolated CSS rgb() string.
   */
  private lerpColor(c1: string, c2: string, t: number): string
  {
    /* Parse each hex color into [R, G, B] arrays. */
    const parse = (c: string) =>
    {
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

  /* ═══════════════════════════════════════════════════════════════════════
     SPEED LINES  (Dramatic+ rally tier)
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawSpeedLines
   * @description Draws thin speed lines trailing behind the ball at Dramatic+ tiers.
   *              Lines are fanned around the backward travel direction.
   *
   * @param ball        The ball.
   * @param rallyCount  Current consecutive hit count (must be ≥ RALLY_TIER_DRAMATIC).
   */
  private drawSpeedLines(ball: Ball, rallyCount: number): void
  {
    const { ctx } = this;

    /* t: 0 at DRAMATIC entry, approaches 1 as rally continues. */
    const t         = Math.min((rallyCount - RALLY_TIER_DRAMATIC) / 12, 1);
    const numLines  = 4 + Math.round(t * 3);
    const spread    = 0.45; // total fan angle (radians)

    /* Opposite of travel direction = where the "wake" goes. */
    const backAngle = Math.atan2(ball.vy, ball.vx) + Math.PI;

    ctx.save();
    ctx.globalAlpha = 0.28 + t * 0.28;
    ctx.strokeStyle = COLOR_P1;
    ctx.lineWidth   = 0.8;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur  = 4;

    for (let i = 0; i < numLines; i++)
    {
      /* Spread lines evenly across the fan.
         Use spinAngle for deterministic per-line variation (no random flicker). */
      const lineAngle = backAngle + (i / (numLines - 1) - 0.5) * spread;
      const length    = 18 + t * 28 + Math.sin(ball.spinAngle + i * 1.3) * 6;

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

  /* ═══════════════════════════════════════════════════════════════════════
     SCREEN-EDGE PULSE  (Legendary rally tier)
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawEdgePulse
   * @description Draws a breathing glow around the full screen perimeter at
   *              Legendary tier (20+ hits).  The effect makes the court feel
   *              "alive" and at the edge of containment.
   *              Drawn outside the zoom transform so it hits true screen edges.
   *
   * @param rallyCount  Current consecutive hit count (must be ≥ RALLY_TIER_LEGENDARY).
   */
  private drawEdgePulse(rallyCount: number): void
  {
    const { ctx } = this;

    /* t: 0 at LEGENDARY entry, approaches 1 as rally continues. */
    const t     = Math.min((rallyCount - RALLY_TIER_LEGENDARY) / 15, 1);

    /* pulse: oscillates 0→1 at ~2Hz using a sine wave. */
    const pulse = (Math.sin(this.t * 0.004) + 1) / 2;

    ctx.save();
    ctx.strokeStyle = COLOR_P1;
    ctx.lineWidth   = 5 + pulse * 5;
    ctx.globalAlpha = (0.12 + t * 0.18) * (0.4 + pulse * 0.6);
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur  = 20 + pulse * 20;
    ctx.strokeRect(1, 1, CANVAS_WIDTH - 2, CANVAS_HEIGHT - 2);
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     IMPACT RINGS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawImpactRings
   * @description Draws expanding neon rings that pulse outward from ball–paddle
   *              contact points.  Rings grow from radius 0 to RING_MAX_RADIUS
   *              and fade out over RING_DURATION_MS.
   *
   * @param rings  Array of active ImpactRing objects.
   */
  private drawImpactRings(rings: ImpactRing[]): void
  {
    const { ctx } = this;
    for (const ring of rings)
    {
      const progress = ring.age / RING_DURATION_MS; // 0 → 1
      const radius   = progress * RING_MAX_RADIUS;
      const alpha    = (1 - progress) * 0.85;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth   = 1.5 * (1 - progress * 0.7);
      ctx.shadowColor = ring.color;
      ctx.shadowBlur  = GLOW_RING * (1 - progress);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     HUD
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawHUD
   * @description Draws all heads-up display elements:
   *   - Difficulty badge (faint, top-right corner)
   *   - Score numbers with pop-scale animation
   *   - Match-progress pip dots under each score
   *   - Rally counter label (bottom center)
   *   - Active boost icons (top edge, near each paddle)
   *   - God Mode badge
   *
   * @param state     Current game state.
   * @param gameTime  Milliseconds since match start (for boost drain bar).
   * @param godMode   true = show all P1 boosts at full, plus GOD badge.
   */
  private drawHUD(state: GameState, gameTime = 0, godMode = false): void
  {
    const { ctx } = this;
    const cx  = CANVAS_WIDTH / 2;
    const p1x = cx - 70;
    const p2x = cx + 70;

    /* ── Score numbers ──────────────────────────────────────────────────
       score1Pop / score2Pop animate from 1.55 → 1.0 via exponential ease
       in tickScorePops(). The extra scale creates a satisfying "pop".   */
    const drawScore = (score: number, pop: number, x: number, y: number, color: string) =>
    {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      ctx.textAlign   = 'center';
      ctx.font        = 'bold 56px system-ui, -apple-system, Arial, sans-serif';
      ctx.shadowColor = color;
      ctx.shadowBlur  = 16 + (pop - 1) * 40; // glow blooms during pop
      ctx.fillStyle   = color;
      ctx.fillText(String(score), 0, 0);
      ctx.restore();
    };

    drawScore(state.score1, state.score1Pop, p1x, 64, COLOR_P1);
    drawScore(state.score2, state.score2Pop, p2x, 64, COLOR_P2);

    /* ── Match-progress pips ── */
    this.drawMatchPips(p1x, state.score1, COLOR_P1);
    this.drawMatchPips(p2x, state.score2, COLOR_P2);

    /* ── Rally counter label (bottom center) ────────────────────────────
       Only shown at BUILDING tier (4+ hits).  Color heats from white
       toward orange as the rally count climbs.                          */
    {
      const label = getRallyLabel(state.rallyCount);
      if (label)
      {
        const heat = Math.min((state.rallyCount - 4) / 21, 1);

        ctx.save();
        ctx.textAlign   = 'center';
        ctx.font        = `${Math.round(14 + heat * 6)}px system-ui, 'Apple Color Emoji', sans-serif`;
        ctx.shadowColor = `rgba(255, 160, 0, ${0.5 + heat * 0.5})`;
        ctx.shadowBlur  = 4 + heat * 18;

        const g = Math.round(255 - heat * 105);
        const b = Math.round(255 - heat * 255);
        ctx.fillStyle = `rgba(255, ${g}, ${Math.max(0, b)}, ${0.6 + heat * 0.35})`;
        ctx.fillText(label, cx, CANVAS_HEIGHT - 14);
        ctx.restore();
      }
    }

    /* ── Active boost icons ── */
    if (state.activeBoosts.length > 0 || godMode)
    {
      this.drawActiveBoostHUD(state.activeBoosts, gameTime, godMode);
    }
  }

  /**
   * @method drawMatchPips
   * @description Draws MATCH_TARGET pip dots under a score to show progress.
   *              Filled dots = points scored; outline dots = points remaining.
   *
   * @param centerX  X center of the score (dots align to this center).
   * @param scored   How many points have been scored.
   * @param color    The player's accent color.
   */
  private drawMatchPips(centerX: number, scored: number, color: string): void
  {
    const { ctx } = this;
    const r     = 3.5;   // dot radius (px)
    const gap   = 11;    // center-to-center spacing (px)
    const startX = centerX - ((MATCH_TARGET - 1) * gap) / 2;
    const y     = 82;

    for (let i = 0; i < MATCH_TARGET; i++)
    {
      const x = startX + i * gap;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);

      if (i < scored)
      {
        /* Filled pip — this point has been scored. */
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 6;
        ctx.globalAlpha = 0.9;
        ctx.fill();
      }
      else
      {
        /* Outline pip — this point is still available. */
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.globalAlpha = 0.22;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COUNTDOWN
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawCountdown
   * @description Draws the serve countdown number (3, 2, 1) centered on screen.
   *              Called externally by Game during the SERVING phase.
   *
   * @param text  The countdown text to display (e.g. "3", "2", "1").
   * @param ball  The ball (position is read but not used — kept for signature compatibility).
   */
  drawCountdown(text: string, ball: Ball): void
  {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign   = 'center';
    ctx.font        = 'bold 80px "Courier New", monospace';
    ctx.fillStyle   = COLOR_P1;
    ctx.shadowColor = COLOR_P1;
    ctx.shadowBlur  = 30;
    ctx.globalAlpha = 0.9;
    ctx.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 28);
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SPIN DISCOVERY LABEL
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawSpinDiscovery
   * @description Draws the "✧ SPIN ✧" tutorial label that appears the first
   *              time the player discovers the spin mechanic.
   *              Called externally by Game.
   *
   * @param x      X position (typically ball center).
   * @param y      Y position (label is offset above this).
   * @param alpha  Opacity 0–1 (fades in/out over spinDiscoveryTimer).
   */
  drawSpinDiscovery(x: number, y: number, alpha: number): void
  {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font        = 'bold 17px "Courier New", monospace';
    ctx.fillStyle   = COLOR_SPARK;
    ctx.textAlign   = 'center';
    ctx.shadowColor = COLOR_SPARK;
    ctx.shadowBlur  = 14;
    ctx.fillText('✧  SPIN  ✧', x, y - 22);
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     POWER-UP ORBS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method powerUpColor
   * @description Maps a PowerUpType to its CSS color string.
   * @param type  The power-up type.
   * @returns {string} CSS color string.
   */
  private powerUpColor(type: PowerUpType): string
  {
    switch (type)
    {
      case 'WIDE_PADDLE':   return COLOR_POWERUP_WIDE;
      case 'SPEED_BOOTS':   return COLOR_POWERUP_SPEED;
      case 'STICKY_PADDLE': return COLOR_POWERUP_STICKY;
      case 'TRAIL_BLAZER':  return COLOR_POWERUP_TRAIL;
    }
  }

  /**
   * @method powerUpLabel
   * @description Maps a PowerUpType to its display name string.
   * @param type  The power-up type.
   * @returns {string} Human-readable label.
   */
  private powerUpLabel(type: PowerUpType): string
  {
    switch (type)
    {
      case 'WIDE_PADDLE':   return 'WIDE PADDLE';
      case 'SPEED_BOOTS':   return 'SPEED BOOTS';
      case 'STICKY_PADDLE': return 'STICKY';
      case 'TRAIL_BLAZER':  return 'TRAIL BLAZER';
    }
  }

  /**
   * @method drawPowerUpIcon
   * @description Draws a small icon representing a power-up type.
   *              Origin is the center of the orb.  All icons are drawn in a
   *              dark fill so they pop against the colored orb body.
   *              `r` is the usable icon radius (fraction of POWERUP_RADIUS).
   *
   * @param type  Which power-up to draw the icon for.
   * @param r     Icon radius (px).
   */
  private drawPowerUpIcon(type: PowerUpType, r: number): void
  {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle   = 'rgba(0,0,0,0.72)';
    ctx.strokeStyle = 'rgba(0,0,0,0.72)';
    ctx.lineWidth   = 1.8;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = 0;

    switch (type)
    {
      case 'WIDE_PADDLE':
      {
        /* Tall thin paddle silhouette with horizontal tick marks at top/bottom. */
        const w = r * 0.28;
        const h = r * 0.92;
        ctx.fillRect(-w / 2, -h / 2, w, h);

        /* Top and bottom tick marks. */
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth   = 1.2;
        ctx.beginPath();
        ctx.moveTo(-w * 1.6, -h / 2);
        ctx.lineTo( w * 1.6, -h / 2);
        ctx.moveTo(-w * 1.6,  h / 2);
        ctx.lineTo( w * 1.6,  h / 2);
        ctx.stroke();
        break;
      }

      case 'SPEED_BOOTS':
      {
        /* Lightning bolt polygon. */
        const pts: [number, number][] =
        [
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

      case 'STICKY_PADDLE':
      {
        /* Bullseye — filled inner disc + thick outer ring. */
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

      case 'TRAIL_BLAZER':
      {
        /* Comet — small circle head + three fading tail lines. */
        const cr = r * 0.28;
        ctx.beginPath();
        ctx.arc(r * 0.20, 0, cr, 0, Math.PI * 2);
        ctx.fill();

        /* Three tail lines spreading leftward at different Y offsets. */
        const tailLengths = [r * 0.70, r * 0.55, r * 0.40];
        const offsets     = [0, r * 0.22, -r * 0.22];
        for (let i = 0; i < 3; i++)
        {
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

  /**
   * @method drawPowerUps
   * @description Draws all power-up orbs currently on the court.
   *              Each orb has: pulsing glow ring, filled body, rotating icon, text label.
   *              Orbs fade in over 400ms and flash in the last 25% of their lifetime.
   *
   * @param powerUps  Array of active PowerUp orbs.
   */
  private drawPowerUps(powerUps: PowerUp[]): void
  {
    const { ctx } = this;
    for (const pu of powerUps)
    {
      const color = this.powerUpColor(pu.type);

      /* Fade in over first 400ms — no popping into existence. */
      const fadeIn = Math.min(1, pu.age / 400);

      /* Warning flash in last 25% of lifetime — tells player to hurry. */
      let alpha = fadeIn;
      if (pu.age > POWERUP_LIFETIME_MS * 0.75)
      {
        alpha = fadeIn * (0.35 + 0.65 * Math.abs(Math.sin(pu.age * 0.015)));
      }

      /* ── Outer pulsing glow ring ── */
      const pulse = 0.7 + 0.3 * Math.sin(pu.age * 0.004);

      ctx.save();
      ctx.globalAlpha = alpha * 0.45 * pulse;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 18 * pulse;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, POWERUP_RADIUS + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      /* ── Filled orb body ── */
      ctx.save();
      ctx.globalAlpha = alpha * 0.88;
      ctx.fillStyle   = color;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 20;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, POWERUP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      /* ── Mini icon (gently rotating with spinAngle) ── */
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pu.x, pu.y);
      ctx.rotate(pu.spinAngle);
      this.drawPowerUpIcon(pu.type, POWERUP_RADIUS * 0.68);
      ctx.restore();

      /* ── Text label beside the orb ── */
      /* Place label to the right if the orb is on the left half, else to the left. */
      const labelRight = pu.x < CANVAS_WIDTH / 2;
      const labelX     = labelRight
        ? pu.x + POWERUP_RADIUS + 10
        : pu.x - POWERUP_RADIUS - 10;

      ctx.save();
      ctx.globalAlpha  = alpha * 0.92;
      ctx.font         = 'bold 10px system-ui, sans-serif';
      ctx.fillStyle    = color;
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 8;
      ctx.textAlign    = labelRight ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.powerUpLabel(pu.type), labelX, pu.y);
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ACTIVE BOOST HUD ICONS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawActiveBoostHUD
   * @description Draws a horizontal row of boost icon pills at the very top of
   *              the screen for each player.
   *
   *              P1 icons are left-aligned; P2 icons are right-aligned.
   *              Each pill contains: dark background, colored tint, mini icon,
   *              and a drain bar that shrinks as the boost expires.
   *
   *              In God Mode, P1 always shows all 4 boost types at full bars.
   *
   * @param boosts    All currently active boosts.
   * @param gameTime  Milliseconds since match start (for remaining duration).
   * @param godMode   true = P1 shows all boosts at 100%.
   */
  private drawActiveBoostHUD(
    boosts:   ActiveBoost[],
    gameTime: number,
    godMode = false
  ): void
  {
    const { ctx } = this;
    const ALL_TYPES: PowerUpType[] = ['WIDE_PADDLE', 'SPEED_BOOTS', 'STICKY_PADDLE', 'TRAIL_BLAZER'];

    /* In God Mode, P1 always shows all 4 types at full duration. */
    const p1Boosts: ActiveBoost[] = godMode
      ? ALL_TYPES.map(t => ({ type: t, owner: 1 as const, expiresAt: Infinity }))
      : boosts.filter(b => b.owner === 1 && b.expiresAt > gameTime);

    const p2Boosts = boosts.filter(b => b.owner === 2 && b.expiresAt > gameTime);

    /* Layout constants. */
    const iconSide = 20; // icon square size (px)
    const barH     = 2;  // drain bar height (px)
    const iconGap  = 4;  // gap between icons (px)
    const topY     = 7;  // distance from top edge (px)

    /* Draw a horizontal row of icon pills. */
    const drawRow = (playerBoosts: ActiveBoost[], rightAlign: boolean) =>
    {
      const totalW = playerBoosts.length * iconSide + Math.max(0, playerBoosts.length - 1) * iconGap;
      const startX = rightAlign ? CANVAS_WIDTH - 8 - totalW : 8;

      playerBoosts.forEach((boost, i) =>
      {
        const color     = this.powerUpColor(boost.type);
        const remaining = Math.min(1, Math.max(0, (boost.expiresAt - gameTime) / POWERUP_BOOST_MS));
        const x         = startX + i * (iconSide + iconGap);
        const cy        = topY + iconSide / 2;

        ctx.save();

        /* Dark pill background. */
        ctx.globalAlpha = 0.82;
        ctx.fillStyle   = 'rgba(0,0,0,0.60)';
        ctx.beginPath();
        ctx.roundRect(x, topY, iconSide, iconSide, 4);
        ctx.fill();

        /* Coloured tint — brighter when more time remains. */
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 5;
        ctx.globalAlpha = 0.18 + remaining * 0.28;
        ctx.beginPath();
        ctx.roundRect(x, topY, iconSide, iconSide, 4);
        ctx.fill();

        /* Mini icon centered in the pill. */
        ctx.globalAlpha = 0.92;
        ctx.shadowBlur  = 0;
        ctx.translate(x + iconSide / 2, cy);
        this.drawPowerUpIcon(boost.type, iconSide * 0.33);
        ctx.translate(-(x + iconSide / 2), -cy);

        /* Drain bar flush below the icon. */
        ctx.globalAlpha = 0.70;
        ctx.fillStyle   = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, topY + iconSide + 1, iconSide, barH);

        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 3;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, topY + iconSide + 1, iconSide * remaining, barH);

        ctx.restore();
      });
    };

    drawRow(p1Boosts, false); // P1: left-aligned
    drawRow(p2Boosts, true);  // P2: right-aligned

    /* ── God Mode badge ─────────────────────────────────────────────────
       Pulsing "⚡ GOD" text to the right of P1's icons.               */
    if (godMode)
    {
      const pulse  = 0.72 + 0.28 * Math.sin(this.t * 0.005);
      const badgeX = 8 + ALL_TYPES.length * (iconSide + iconGap) + 6;

      ctx.save();
      ctx.globalAlpha  = pulse;
      ctx.font         = 'bold 9px system-ui, sans-serif';
      ctx.fillStyle    = '#ffe600';
      ctx.shadowColor  = '#ffe600';
      ctx.shadowBlur   = 10;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ GOD', badgeX, topY + iconSide / 2);
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WALL BOUNDARY BARS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawWallBoundaries
   * @description Draws solid glowing bars along the top and bottom edges of
   *              the court to make the boundaries clearly visible.
   *              Brightness scales with rally intensity.
   *
   * @param courtIntensity  1 = normal; higher = brighter glow.
   * @param courtColor      Hex color string — driven by the current difficulty.
   */
  private drawWallBoundaries(courtIntensity = 1, courtColor = COLOR_P1): void
  {
    const { ctx } = this;
    const thickness = 5;
    const alpha     = Math.min(0.7 + (courtIntensity - 1) * 0.2, 0.95);
    const blur      = 8 + (courtIntensity - 1) * 6;

    ctx.save();
    ctx.fillStyle   = courtColor;
    ctx.shadowColor = courtColor;
    ctx.shadowBlur  = blur;
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, CANVAS_WIDTH, thickness);                          // top wall
    ctx.fillRect(0, CANVAS_HEIGHT - thickness, CANVAS_WIDTH, thickness);  // bottom wall
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     STICKY POWER-UP EFFECTS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method drawStickyBallEffect
   * @description Draws a magenta corona and depleting arc timer around the ball
   *              while it is being held by a STICKY_PADDLE.
   *
   *              The arc starts full (2π) when the ball is first caught and
   *              shrinks to zero just before the ball is released.
   *
   * @param ball  The ball currently being held.
   */
  private drawStickyBallEffect(ball: Ball): void
  {
    const { ctx } = this;
    const progress = ball.stickyHoldMs / POWERUP_STICKY_HOLD_MS; // 1 → 0
    const pulse    = 0.7 + 0.3 * Math.sin(this.t * 0.018);

    /* ── Pulsing corona ── */
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

    /* ── Depleting arc timer ── */
    const arcLen = progress * Math.PI * 2; // full circle → 0
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

  /**
   * @method drawStickyPaddleEffect
   * @description Draws three pulsing concentric rings expanding outward from
   *              the paddle that is currently holding the ball.
   *              The rings continuously cycle (modulo 2π) to create a "ripple" effect.
   *
   * @param paddle        The paddle holding the ball.
   * @param stickyHoldMs  Remaining hold time (ms) — not currently used for scaling
   *                      but passed for potential future use.
   */
  private drawStickyPaddleEffect(paddle: Paddle, stickyHoldMs: number): void
  {
    const { ctx } = this;

    /* Center of the paddle face. */
    const cx = paddle.x + paddle.recoilOffset + paddle.width  / 2;
    const cy = paddle.y + paddle.emotionOffset + paddle.height / 2;
    const t  = this.t * 0.007;

    for (let i = 0; i < 3; i++)
    {
      /* Each ring is offset in phase so they form a continuous ripple. */
      const ringT  = ((t + i * 0.8) % (Math.PI * 2)) / (Math.PI * 2);
      const radius = 8 + ringT * 22;
      const alpha  = (1 - ringT) * 0.55;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = COLOR_POWERUP_STICKY;
      ctx.shadowColor = COLOR_POWERUP_STICKY;
      ctx.shadowBlur  = 10;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
