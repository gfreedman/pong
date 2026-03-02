/**
 * @file constants.ts
 * @description Single source of truth for every numeric and color tuning value in Neon Pong.
 *
 * WHY A CONSTANTS FILE?
 * ---------------------
 * Magic numbers scattered throughout code are hard to understand and easy to
 * accidentally duplicate.  Keeping every tuning value here means:
 *   - There is exactly one place to look when you want to change how something feels.
 *   - TypeScript will catch typos (string constants) at compile time.
 *   - Values have names that explain *what* they mean, not just *what* they are.
 *
 * UNITS
 * -----
 * Unless otherwise noted:
 *   - Distances / positions / radii are in *canvas pixels* (px).
 *   - Velocities / speeds are in *pixels per second* (px/s).
 *   - Durations / timers are in *milliseconds* (ms).
 *   - Angles are in *degrees* unless the variable name ends in "Rad".
 *   - Scale factors are dimensionless (1.0 = no change).
 */

/* ═══════════════════════════════════════════════════════════════════════════
   CANVAS
   The game always renders into a 960 × 540 buffer (16:9).
   CSS scaling in main.ts makes this fill any viewport without distortion.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Logical canvas height in pixels — fixed at 540. */
export const CANVAS_HEIGHT = 540;

/**
 * Logical canvas width — set at startup by setCanvasWidth() to match the
 * viewport's actual aspect ratio.  All game systems use this live value so
 * the play field fills the screen with zero bars on any display.
 */
export let CANVAS_WIDTH = 960;

/**
 * Call once in main(), before new Game(), to lock the canvas width to the
 * viewport's aspect ratio.  CANVAS_HEIGHT stays fixed at 540; only the
 * width is adjusted so the game coordinate space is always exactly
 * viewport-shaped.
 */
export function setCanvasWidth(viewportW: number, viewportH: number): void
{
  CANVAS_WIDTH = Math.round(CANVAS_HEIGHT * viewportW / viewportH);
}

/**
 * Safe-area insets, converted from CSS pixels → game pixels.
 * Set once at startup (main.ts reads env() via CSS custom properties).
 * Applied in makePaddle() so both paddles clear the notch/home-indicator.
 */
export let SAFE_INSET_LEFT_PX  = 0;
export let SAFE_INSET_RIGHT_PX = 0;

/**
 * @function setSafeInsets
 * @description Converts CSS-pixel safe-area insets to game-pixel offsets
 *              and stores them for use by makePaddle().
 *
 *              Must be called after setCanvasWidth() so CANVAS_WIDTH is final.
 *
 * @param leftCSS   env(safe-area-inset-left)  in CSS pixels.
 * @param rightCSS  env(safe-area-inset-right) in CSS pixels.
 */
export function setSafeInsets(leftCSS: number, rightCSS: number): void
{
  /* Scale: 1 CSS px = CANVAS_HEIGHT / window.innerHeight game px.
     Same ratio the renderer uses for its game transform.            */
  const scale        = CANVAS_HEIGHT / window.innerHeight;
  SAFE_INSET_LEFT_PX  = Math.ceil(leftCSS  * scale);
  SAFE_INSET_RIGHT_PX = Math.ceil(rightCSS * scale);
}

/** Target frames per second.  Used to size pre-allocated arrays and time-step sanity checks. */
export const TARGET_FPS    = 60;

/* ═══════════════════════════════════════════════════════════════════════════
   COLORS
   Every CSS color string used anywhere in the renderer lives here so the
   palette stays consistent and easy to retheme.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Deep navy background — the "space" behind the court. */
export const COLOR_BG          = '#0a0a2e';

/** Player 1 (left / human) accent color — cyan neon. */
export const COLOR_P1          = '#00f0ff';

/** Player 2 (right / AI) accent color — magenta neon. */
export const COLOR_P2          = '#ff00aa';

/** Ball fill color — bright white so it pops against the dark BG. */
export const COLOR_BALL        = '#ffffff';

/** Court line / net color — cyan tinted with heavy transparency. */
export const COLOR_COURT       = 'rgba(0, 240, 255, 0.18)';

/** Spark / particle color — vivid yellow, used for goal bursts. */
export const COLOR_SPARK       = '#ffe600';

/** Paddle color during the brief flash after it hits the ball — orange burst. */
export const COLOR_HIT_FLASH   = '#ff6600';

/* ═══════════════════════════════════════════════════════════════════════════
   BALL — physics values
   The ball's speed increases every time it touches a paddle so rallies feel
   progressively more intense.  Speed is capped so the game stays fair.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Collision and rendering radius of the ball (px). */
export const BALL_RADIUS         = 12;

/**
 * Speed the ball starts at when first served (px/s).
 * ≈ 5 pixels per frame at 60 fps.
 */
export const BALL_BASE_SPEED     = 300;

/** Speed added to the ball each time a paddle makes contact (px/s). */
export const BALL_SPEED_INC      = 9;

/**
 * Hard cap on ball speed (px/s).
 * ≈ 12 pixels per frame at 60 fps — fast but trackable by the human eye.
 */
export const BALL_MAX_SPEED      = 720;

/**
 * Maximum angle (in degrees) the ball can travel off the horizontal axis.
 * A hit dead-center sends the ball straight; a hit near the edge redirects
 * it by up to this many degrees.  60° keeps edge hits steep but not vertical.
 */
export const BALL_MAX_ANGLE_DEG  = 60;

/* ═══════════════════════════════════════════════════════════════════════════
   BALL TRAIL
   A ring buffer of recent ball positions is drawn as a fading streak.
   The trail grows longer and brighter at high rally counts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Maximum number of historical positions stored in the trail ring buffer. */
export const TRAIL_LENGTH        = 22;

/** How frequently (ms) a new point is appended to the trail. */
export const TRAIL_INTERVAL_MS   = 14;

/* ═══════════════════════════════════════════════════════════════════════════
   PADDLE — physics values
   The player's paddle uses acceleration + deceleration curves modeled
   loosely after Mario's skid physics: high carry at speed, gentle drift to stop.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Paddle width (px).  Narrow enough to miss the ball on edge hits. */
export const PADDLE_WIDTH        = 12;

/** Paddle height at rest (px).  Can temporarily grow with WIDE_PADDLE power-up. */
export const PADDLE_HEIGHT       = 80;

/** Maximum speed the player's paddle can reach under human input (px/s). */
export const PADDLE_BASE_SPEED   = 520;

/** Distance the paddle is placed from its canvas edge (px). */
export const PADDLE_MARGIN       = 30;

/**
 * Velocity gained per frame when the player is actively pressing a direction.
 * Note: this is per-frame (not per-second) intentionally — it gives a snappy,
 * arcade feel that feels better than a normalized per-second value.
 */
export const PADDLE_ACCEL        = 26;

/**
 * Velocity multiplier applied while the paddle is at (or near) max speed.
 * Values < 1 mean the paddle loses a fraction of its speed each frame — this
 * creates the "carry momentum" feeling where a fast-moving paddle takes longer
 * to slow down than a slow one.
 */
export const PADDLE_DECEL_FAST   = 0.96;

/**
 * Velocity multiplier applied while the paddle is nearly stopped.
 * A slightly lower value here (or the same) creates a gentle final drift to zero
 * rather than snapping abruptly from 1 px/s to 0.
 */
export const PADDLE_DECEL_SLOW   = 0.96;

/**
 * Power-curve exponent that blends between DECEL_FAST and DECEL_SLOW.
 * >1 means the paddle spends proportionally longer in the FAST zone (more carry).
 * The formula is:  t = (|vy| / maxSpeed)^CURVE,  then  decel = lerp(SLOW, FAST, t).
 */
export const PADDLE_DECEL_CURVE  = 1.6;

/**
 * Fraction of velocity that "bleeds" past the stop point before the paddle
 * reverses.  Simulates the tiny overshoot that makes movement feel physical
 * rather than robotically precise.
 */
export const PADDLE_OVERSHOOT    = 0.10;

/* ═══════════════════════════════════════════════════════════════════════════
   PADDLE BREATHING
   Each paddle oscillates very subtly in height to suggest it is "alive".
   The amplitude is deliberately tiny — just enough to feel organic.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Peak-to-peak height oscillation (px).  Tiny so it reads as organic, not glitchy. */
export const BREATH_AMP_PX      = 0.5;

/** Oscillation frequency (Hz).  0.5 Hz = one breath every 2 seconds. */
export const BREATH_FREQ_HZ     = 0.5;

/* ═══════════════════════════════════════════════════════════════════════════
   SPIN PHYSICS
   When the player moves the paddle while hitting the ball, spin is imparted.
   Spin applies a continuous vy force that curves the ball's path in flight.
   The effect decays exponentially so it fades naturally, not abruptly.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How much paddle vertical velocity translates into ball spin units.
 * spin += paddleVy * SPIN_IMPART_FACTOR on each paddle contact.
 * Kept small so casual play doesn't cause wild curves.
 */
export const SPIN_IMPART_FACTOR  = 0.006;

/**
 * Curve force applied per spin unit per second (px/s² per spin unit).
 * Each frame: ball.vy += spin * SPIN_CURVE_FORCE * deltaSeconds.
 * Positive spin = topspin (curves downward); negative = backspin.
 */
export const SPIN_CURVE_FORCE    = 90;

/**
 * Exponential decay constant for spin (per second).
 * Each second: spin *= (1 - SPIN_DECAY_PER_S).
 * 0.22 ≈ spin halves roughly every 2.7 seconds — long-lasting but not permanent.
 */
export const SPIN_DECAY_PER_S    = 0.22;

/**
 * Fraction of spin retained after the ball bounces off a top/bottom wall.
 * 0.55 = 45% of spin is lost on a wall bounce — realistic energy absorption.
 */
export const SPIN_WALL_RETAIN    = 0.55;

/* ═══════════════════════════════════════════════════════════════════════════
   HIT FEEL — hitstop / squash / stretch
   "Hit feel" is the collection of micro-animations that fire on every ball–
   paddle contact.  The goal is to make every hit feel satisfyingly weighty.

   Hitstop: ball and paddle freeze for 2-3 frames so the hit "registers".
   Squash:  ball flattens against the paddle face immediately on contact.
   Stretch: ball elongates in its travel direction just after leaving the paddle.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Hitstop duration for slow hits (≈ 2 frames at 60fps). */
export const HITSTOP_SLOW_MS     = 33;

/** Hitstop duration for fast hits (≈ 3 frames at 60fps). */
export const HITSTOP_FAST_MS     = 50;

/** Ball speed (px/s) above which the longer 3-frame hitstop is used. */
export const HITSTOP_SPEED_THRESHOLD = 520;

/** How long the squash deformation lasts (ms). */
export const SQUASH_DURATION_MS  = 55;

/** How long the stretch deformation lasts (ms). */
export const STRETCH_DURATION_MS = 90;

/** Scale factor during squash — < 1 compresses the ball along one axis. */
export const SQUASH_AMOUNT       = 0.65;

/** Scale factor during stretch — > 1 elongates the ball in travel direction. */
export const STRETCH_AMOUNT      = 1.40;

/* ── Paddle recoil spring ──────────────────────────────────────────────────
   The paddle is physically "pushed back" on contact and springs forward.
   The spring model uses: force = -K * displacement, damped each frame by DAMP. */

/** How many pixels the paddle is pushed back on contact. */
export const PADDLE_RECOIL_PX    = 5;

/** Spring stiffness constant — higher = snappier return. */
export const RECOIL_SPRING_K     = 28;

/** Spring damping factor per frame — lower = more oscillation before settling. */
export const RECOIL_SPRING_DAMP  = 0.65;

/* ── Chromatic aberration flash ─────────────────────────────────────────── */

/** Duration of the RGB-channel split effect after a paddle hit (ms). */
export const CHROMATIC_MS           = 50;

/** Pixel offset between the R, G, and B channel layers during the effect. */
export const CHROMATIC_OFFSET       = 3;

/** Duration of the blue → orange → blue color flash on paddle contact (ms). */
export const PADDLE_COLOR_FLASH_MS  = 180;

/* ═══════════════════════════════════════════════════════════════════════════
   IMPACT RING
   An expanding semi-transparent ring emanates from the contact point on every
   paddle hit.  It grows outward and fades to invisible over RING_DURATION_MS.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Maximum radius the impact ring reaches before disappearing (px). */
export const RING_MAX_RADIUS     = 44;

/** Total lifetime of the impact ring (ms). */
export const RING_DURATION_MS    = 160;

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN SHAKE
   The camera briefly shakes on hard hits and goals to add physical weight.
   Intensity = maximum random pixel displacement; duration = how long it lasts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Max pixel displacement per frame during a paddle-hit shake. */
export const SHAKE_HIT_INTENSITY = 2;

/** Duration of paddle-hit screen shake (ms). */
export const SHAKE_HIT_MS        = 160;

/** Max pixel displacement per frame during a goal shake — bigger than a hit. */
export const SHAKE_GOAL_INTENSITY= 6;

/** Duration of goal screen shake (ms). */
export const SHAKE_GOAL_MS       = 300;

/* ═══════════════════════════════════════════════════════════════════════════
   NEON GLOW
   shadowBlur is the CSS/Canvas API's blur radius for the drop-shadow effect
   that creates the "neon" look.  Larger = softer, more diffuse glow.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Glow (shadowBlur) radius applied to paddles (px). */
export const GLOW_PADDLE         = 14;

/** Glow (shadowBlur) radius applied to the ball (px). */
export const GLOW_BALL           = 20;

/** Glow (shadowBlur) radius applied to impact rings (px). */
export const GLOW_RING           = 8;

/* ═══════════════════════════════════════════════════════════════════════════
   PADDLE EMOTION
   After a score or concede the paddle "reacts" — it jumps up when its player
   scores and sags down when they concede.  The vertical offset springs back
   to zero using the same spring model as the recoil.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Initial upward offset (px) applied when the paddle's player scores. Negative = up. */
export const EMOTION_JUMP_PX     = -5;

/** Initial downward offset (px) applied when the paddle concedes a point. */
export const EMOTION_SAG_PX      = 8;

/** Spring stiffness for the emotion offset return animation. */
export const EMOTION_SPRING_K    = 18;

/** Spring damping per frame for the emotion offset return animation. */
export const EMOTION_SPRING_DAMP = 0.6;

/* ═══════════════════════════════════════════════════════════════════════════
   BALL FACE REACTIONS
   The ball has a tiny face (eye + optional frown) that reacts to events.
   These timers control how long each expression lasts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Duration of the "wide eye" expression after a paddle hit (ms). ≈ 4 frames. */
export const HIT_EYE_FLASH_MS    = 67;

/** Duration of the "sad frown + small eye" expression after the ball enters a goal (ms). */
export const BALL_SAD_MS         = 500;

/* ═══════════════════════════════════════════════════════════════════════════
   GOAL EFFECTS
   When a goal is scored the renderer plays a multi-part visual fanfare:
     1. A half-court white flash.
     2. A burst of colored particles that arc under gravity.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Duration of the half-court white flash (ms). ≈ 8 frames. */
export const GOAL_FLASH_MS        = 133;

/** Lifetime of each goal-burst particle (ms). ≈ 40 frames. */
export const GOAL_PARTICLE_MS     = 667;

/** Number of particles spawned per goal. */
export const GOAL_PARTICLE_COUNT  = 35;

/** Downward acceleration applied to each particle (px/s²) — simulates gravity. */
export const GOAL_PARTICLE_GRAVITY = 150;

/* ═══════════════════════════════════════════════════════════════════════════
   WALL MARKS (scorch marks)
   Each time the ball hits a top/bottom wall it burns a faint mark that fades.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Time for a wall scorch mark to fade completely (ms). */
export const WALL_MARK_FADE_MS   = 10000;

/** Duration of the brightness pulse on the top/bottom wall bars after a bounce (ms). */
export const WALL_FLASH_MS       = 220;

/* ═══════════════════════════════════════════════════════════════════════════
   MATCH
   ═══════════════════════════════════════════════════════════════════════════ */

/** Number of points needed to win a match. */
export const MATCH_TARGET        = 5;

/* ═══════════════════════════════════════════════════════════════════════════
   SERVE SEQUENCE
   After every point the game pauses for an "exhale", then waits for the
   serving player to press a key, then runs a 3-2-1 countdown.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Maximum angle (± degrees from horizontal) the serve direction can take. */
export const SERVE_ANGLE_RANGE   = 30;

/** Duration of the 3-2-1 countdown from "GO!" to ball launch (ms per beat). */
export const SERVE_COUNTDOWN_MS  = 1000;

/* ═══════════════════════════════════════════════════════════════════════════
   RALLY ESCALATION TIERS
   As a rally grows the game escalates visually and audibly through four tiers.
   Each tier unlocks additional effects to build tension.

   Tier 0 (hits < 4):  Normal gameplay, no bonus effects.
   Tier 1 BUILDING  :  Subtle bass drone starts.  Trail grows.
   Tier 2 INTENSE   :  Court starts glowing.  Slow zoom begins.
   Tier 3 DRAMATIC  :  Speed lines.  Background warms.
   Tier 4 LEGENDARY :  Edge pulse.  Maximum everything.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Rally hit count at which tier 1 (BUILDING) activates. */
export const RALLY_TIER_BUILDING   = 4;

/** Rally hit count at which tier 2 (INTENSE) activates. */
export const RALLY_TIER_INTENSE    = 8;

/** Rally hit count at which tier 3 (DRAMATIC) activates. */
export const RALLY_TIER_DRAMATIC   = 13;

/** Rally hit count at which tier 4 (LEGENDARY) activates. */
export const RALLY_TIER_LEGENDARY  = 20;

/* ═══════════════════════════════════════════════════════════════════════════
   EXHALE (pause between points)
   After every goal the game holds its breath before allowing the next serve.
   Longer rallies earn a longer pause — the silence IS the drama.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Base pause duration after every goal, regardless of rally length (ms). */
export const EXHALE_BASE_MS        = 900;

/** Extra pause added per rally hit that preceded the goal (ms/hit). */
export const EXHALE_PER_RALLY_HIT  = 65;

/** Cap on the total extra exhale time to prevent indefinite pausing (ms). */
export const EXHALE_EXTRA_CAP_MS   = 1500;

/** How long the ball spends fading in during the exhale phase (ms). */
export const BALL_MATERIALIZE_MS   = 700;

/* ═══════════════════════════════════════════════════════════════════════════
   SERVE PENDING
   In SERVE_PENDING the human is shown "Press Space to serve".
   The AI auto-readies after SERVE_PENDING_AI_MS so the game can't stall.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Milliseconds before the AI auto-signals ready during SERVE_PENDING. */
export const SERVE_PENDING_AI_MS   = 1800;

/* ═══════════════════════════════════════════════════════════════════════════
   RALLY ZOOM
   At intense rallies the canvas very slightly zooms in toward the center
   (via a CSS scale transform) to create cinematic tension.
   The values below are the *extra* scale added on top of 1.0.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Extra canvas scale factor applied at tier 2 (INTENSE). e.g. 0.010 → 1.010× zoom. */
export const ZOOM_INTENSE          = 0.010;

/** Extra canvas scale factor applied at tier 3 (DRAMATIC). */
export const ZOOM_DRAMATIC         = 0.018;

/** Extra canvas scale factor applied at tier 4 (LEGENDARY). */
export const ZOOM_LEGENDARY        = 0.025;

/* ═══════════════════════════════════════════════════════════════════════════
   LEGENDARY GOAL SHAKE
   When a 20+ hit rally ends with a goal the screen shake is bigger and longer
   than a normal goal shake to underscore the magnitude of the moment.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Max pixel displacement per frame during a legendary-rally goal shake. */
export const LEGENDARY_SHAKE_INTENSITY = 10;

/** Duration of the legendary-goal screen shake (ms). */
export const LEGENDARY_SHAKE_MS        = 600;

/* ═══════════════════════════════════════════════════════════════════════════
   AI TUNING — Medium (default)
   The AI uses a predict-then-track control loop.  Three difficulty tiers each
   tune a different combination of speed, reaction delay, and target accuracy.

   MEDIUM is the "baseline" tuning referenced in game design discussions.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Fraction of PADDLE_BASE_SPEED the Medium AI can reach (0–1). */
export const AI_SPEED_FACTOR       = 0.85;

/** Minimum ms between Medium AI target recalculations (simulates reaction time). */
export const AI_REACTION_DELAY_MIN = 120;

/** Maximum ms between Medium AI target recalculations. */
export const AI_REACTION_DELAY_MAX = 180;

/** Maximum ±px random error added to the Medium AI's predicted ball position. */
export const AI_TARGET_OFFSET_MAX  = 40;

/* ─── AI Tuning — Easy ───────────────────────────────────────────────────── */

/** Fraction of PADDLE_BASE_SPEED the Easy AI can reach. */
export const AI_EASY_SPEED_FACTOR       = 0.58;

/** Min ms between Easy AI recalculations (slower reactions). */
export const AI_EASY_REACTION_DELAY_MIN = 240;

/** Max ms between Easy AI recalculations. */
export const AI_EASY_REACTION_DELAY_MAX = 380;

/** Max ±px random error for Easy AI — larger = misses more. */
export const AI_EASY_TARGET_OFFSET_MAX  = 90;

/* ─── AI Tuning — Hard ───────────────────────────────────────────────────── */

/** Fraction of PADDLE_BASE_SPEED the Hard AI can reach. */
export const AI_HARD_SPEED_FACTOR       = 0.97;

/** Min ms between Hard AI recalculations (near-instant reactions). */
export const AI_HARD_REACTION_DELAY_MIN = 55;

/** Max ms between Hard AI recalculations. */
export const AI_HARD_REACTION_DELAY_MAX = 95;

/** Max ±px random error for Hard AI — very small, nearly precise. */
export const AI_HARD_TARGET_OFFSET_MAX  = 6;

/* ─── AI Form System — Streak / hot-cold dynamics ───────────────────────────
   The Skill Curve Model gives the AI a "form" value in [-1, +1].
   Scoring a point pushes form toward +1 (hot streak).
   Conceding a point pushes form toward -1 (cold streak).
   Form decays slowly toward 0 each frame so streaks fade naturally.

   Effective parameters (speed, reaction delay, error) are derived from form
   each decision cycle, so the AI's quality ebbs and flows like a real player.
   False reads — mirrored trajectory predictions — simulate misreading spin or
   bounce angle.  They only fire on cold streaks so they feel earned, not random.

   Tests access config.speedFactor / reactionDelayMin / reactionDelayMax via
   `as any` and check baseline values at neutral form (form = 0), which matches
   the original constants.  The dynamic modulation is invisible to those tests.
   ─────────────────────────────────────────────────────────────────────────── */

/** Form increase applied when the AI scores a point (hot streak bonus). */
export const AI_FORM_HIT_BONUS           = 0.20;

/** Form decrease applied when the AI concedes a point (cold streak penalty). */
export const AI_FORM_MISS_PENALTY        = 0.25;

/**
 * Per-frame form decay rate.  Each frame: form *= (1 - AI_FORM_DECAY_PER_FRAME).
 * 0.0015 → form halves in ≈ 462 frames (≈ 7.7 seconds at 60 fps).
 */
export const AI_FORM_DECAY_PER_FRAME     = 0.0015;

/* ─── EASY tier form tuning ─────────────────────────────────────────────── */

/**
 * How much form shifts EASY AI behavior.  Large value = highly streaky.
 * Hot streak: surprisingly quick and accurate.  Cold streak: very sloppy.
 */
export const AI_EASY_FORM_INFLUENCE      = 0.45;

/**
 * Base probability of a "false read" per decision cycle when EASY AI is cold.
 * Scaled by Math.max(0, -form) so it only triggers during cold streaks.
 * False read = AI simulates the mirrored trajectory (targets the wrong side).
 */
export const AI_EASY_FALSE_READ_CHANCE   = 0.30;

/* ─── MEDIUM tier form tuning ───────────────────────────────────────────── */

/** How much form shifts MEDIUM AI behavior.  Moderate streakiness. */
export const AI_FORM_INFLUENCE           = 0.28;

/** Base probability of a false-read for MEDIUM AI when maximally cold. */
export const AI_FALSE_READ_CHANCE        = 0.12;

/* ─── HARD tier form tuning ─────────────────────────────────────────────── */

/**
 * How much form shifts HARD AI behavior.  Small = stays dangerous even when cold.
 * A skilled player can bait hard into rare false reads with heavy spin.
 */
export const AI_HARD_FORM_INFLUENCE      = 0.13;

/** Base probability of a false-read for HARD AI when maximally cold. */
export const AI_HARD_FALSE_READ_CHANCE   = 0.04;

/* ═══════════════════════════════════════════════════════════════════════════
   POWER-UP COLLECTIBLES
   Orbs float onto the court mid-match and grant temporary boosts.
   Spawn timing is randomized between MIN and MAX so orbs don't feel scripted.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Left X boundary of the orb spawn zone — clear of the P1 paddle area. */
export const POWERUP_SPAWN_MIN_X    = 260;

/** Right X boundary of the orb spawn zone — clear of the P2 paddle area. */
export const POWERUP_SPAWN_MAX_X    = 700;

/** Top Y boundary of the orb spawn zone — away from the wall. */
export const POWERUP_SPAWN_MIN_Y    = 80;

/** Bottom Y boundary of the orb spawn zone — away from the wall. */
export const POWERUP_SPAWN_MAX_Y    = 460;

/** Minimum wait after the last orb before a new one can spawn (ms). */
export const POWERUP_SPAWN_MIN_MS   = 8000;

/** Maximum wait after the last orb before a new one spawns (ms). */
export const POWERUP_SPAWN_MAX_MS   = 18000;

/** How long an uncollected orb stays on the court before it fades out (ms). */
export const POWERUP_LIFETIME_MS    = 8000;

/** How long a collected boost stays active for the player (ms). */
export const POWERUP_BOOST_MS       = 8000;

/** Collision detection radius for orb collection (px). */
export const POWERUP_RADIUS         = 20;

/** WIDE_PADDLE multiplier: paddle height grows by this factor. */
export const POWERUP_WIDE_FACTOR    = 1.5;

/** SPEED_BOOTS multiplier: paddle max speed increases by this factor. */
export const POWERUP_SPEED_FACTOR   = 1.4;

/** TRAIL_BLAZER multiplier: trail length and brightness scale by this factor. */
export const POWERUP_TRAIL_FACTOR   = 3.0;

/** STICKY_PADDLE: ball is held on the paddle for this many milliseconds before auto-releasing. */
export const POWERUP_STICKY_HOLD_MS  = 500;

/** SPEED_BOOTS: extra acceleration multiplier applied while the boost is active. */
export const POWERUP_SPEED_ACCEL_FACTOR = 1.5;

/** TRAIL_BLAZER: bonus speed (px/s) added to the ball on each hit while active. */
export const POWERUP_TRAIL_SPEED_BONUS  = 25;

/* ═══════════════════════════════════════════════════════════════════════════
   GOAT MODE  (secret cheat)
   Activated by holding G + O + A + T simultaneously.  Toggles on/off.
   ═══════════════════════════════════════════════════════════════════════════ */

/** P1 paddle height while GOAT mode is active — half the canvas height. */
export const GOAT_PADDLE_HEIGHT  = CANVAS_HEIGHT / 2;

/** Spin magnitude applied on every P1 hit in GOAT mode. */
export const GOAT_SPIN_AMOUNT    = 12;

/** Speed multiplier applied to the ball on every P1 hit in GOAT mode. */
export const GOAT_SPEED_MULT     = 4;

/** Absolute ball speed cap while GOAT mode is active (px/s). */
export const GOAT_BALL_MAX_SPEED = BALL_MAX_SPEED * 4;

/* ─── Power-up orb colors ────────────────────────────────────────────────── */

/** Color of the WIDE_PADDLE orb — green. */
export const COLOR_POWERUP_WIDE    = '#44ff88';

/** Color of the SPEED_BOOTS orb — yellow. */
export const COLOR_POWERUP_SPEED   = '#ffe600';

/** Color of the STICKY_PADDLE orb — magenta (matches P2 so it feels like a trap). */
export const COLOR_POWERUP_STICKY  = '#ff00aa';

/** Color of the TRAIL_BLAZER orb — cyan (matches P1 so it reads as a power move). */
export const COLOR_POWERUP_TRAIL   = '#00f0ff';
