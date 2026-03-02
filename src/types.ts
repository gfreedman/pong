/**
 * @file types.ts
 * @description All shared TypeScript interfaces, types, and enums for Neon Pong.
 *
 * Every other module imports from here.  Keeping types centralised means
 * there is one place to look when you want to know the shape of any object
 * in the game.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   GAME PHASE
   The game is a *finite state machine* — it is always in exactly one phase,
   and transitions between phases follow strict rules.

   Diagram (simplified):
     DIFFICULTY_SELECT → POINT_SCORED → SERVE_PENDING → SERVING → PLAYING
                                                                       ↓
                                                                  MATCH_END
                                                                       ↓
                                                           DIFFICULTY_SELECT
     Any in-game phase ←→ PAUSED  (Escape key toggles)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef GamePhase
 * @description Identifies which state the game is currently in.
 *   - PLAYING           Ball is live; normal gameplay.
 *   - PAUSED            Player pressed Escape; everything is frozen.
 *   - DIFFICULTY_SELECT HTML overlay shown before a match begins.
 *   - POINT_SCORED      Brief exhale pause after a goal; ball invisible.
 *   - SERVE_PENDING     Waiting for the player to press a key to serve.
 *   - SERVING           3-2-1 countdown before the ball launches.
 *   - MATCH_END         A player reached MATCH_TARGET; match is over.
 */
export type GamePhase =
  | 'PLAYING'
  | 'PAUSED'
  | 'DIFFICULTY_SELECT'
  | 'POINT_SCORED'
  | 'SERVE_PENDING'
  | 'SERVING'
  | 'MATCH_END';

/**
 * @typedef Difficulty
 * @description AI skill level selected on the pre-match difficulty screen.
 */
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/**
 * @typedef PlayerSide
 * @description Which side of the court the human player controls.
 */
export type PlayerSide = 'LEFT' | 'RIGHT';

/* ═══════════════════════════════════════════════════════════════════════════
   POWER-UPS
   Collectible orbs that float onto the court mid-match and grant the
   collecting player a temporary gameplay boost.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef PowerUpType
 * @description The four power-up varieties a player can collect.
 *   - WIDE_PADDLE   Temporarily increases paddle height.
 *   - SPEED_BOOTS   Temporarily increases paddle max speed.
 *   - STICKY_PADDLE Ball sticks to the paddle briefly, allowing aimed shots.
 *   - TRAIL_BLAZER  Ball gains speed on every hit while active.
 */
export type PowerUpType = 'WIDE_PADDLE' | 'SPEED_BOOTS' | 'STICKY_PADDLE' | 'TRAIL_BLAZER';

/**
 * @interface PowerUp
 * @description A single power-up orb currently sitting on the court, waiting to be collected.
 */
export interface PowerUp
{
  /** Unique sequential ID — used to avoid processing the same orb twice. */
  id: number;

  /** Which kind of power-up this orb grants. */
  type: PowerUpType;

  /** Horizontal centre position on the canvas (px). */
  x: number;

  /** Vertical centre position on the canvas (px). */
  y: number;

  /** Milliseconds since this orb spawned. Used for fade-in and expiry. */
  age: number;

  /** Accumulated rotation in radians — drives the gentle icon spin animation. */
  spinAngle: number;
}

/**
 * @interface ActiveBoost
 * @description A power-up that has been collected and is currently active for a player.
 */
export interface ActiveBoost
{
  /** Which kind of boost is active. */
  type: PowerUpType;

  /** Which player owns this boost (1 = left/human, 2 = right/AI). */
  owner: 1 | 2;

  /** The gameTime (ms) at which this boost expires. */
  expiresAt: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BALL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @interface TrailPoint
 * @description One historical position stored in the ball's motion trail.
 *              The trail array holds the last N positions, newest at index 0.
 */
export interface TrailPoint
{
  x: number;
  y: number;
}

/**
 * @interface Ball
 * @description Complete state of the game ball.
 *
 * Physics overview:
 *   - (x, y) is the ball centre in canvas pixels.
 *   - (vx, vy) is the velocity in pixels per second.
 *   - spin is a scalar applied every frame as an extra vy acceleration.
 *     Positive spin = topspin (curves the ball downward).
 *     Negative spin = backspin  (curves the ball upward).
 *     Spin decays exponentially each frame.
 */
export interface Ball
{
  /** Centre position (px). */
  x: number;
  y: number;

  /** Velocity components (px/s). */
  vx: number;
  vy: number;

  /** Spin magnitude — decays each frame; drives the curve effect. */
  spin: number;

  /** Collision and rendering radius (px). */
  radius: number;

  /** Current speed magnitude (px/s). Increases per hit, capped at BALL_MAX_SPEED. */
  speed: number;

  /* ── Hit-feel animation timers ──────────────────────────────────────────
     Each counts down from its initial value (ms) to zero.               */

  /** Ball and paddle freeze briefly on contact so the hit "registers" visually. */
  hitstopTimer: number;

  /** Ball squashes flat against the paddle during impact. */
  squashTimer: number;

  /** Ball stretches in the travel direction immediately after leaving the paddle. */
  stretchTimer: number;

  /* ── Ball face expression timers ── */

  /** Eye widens (~4 frames) right after a paddle hit. */
  hitFlashTimer: number;

  /** Frown + smaller eye for 500 ms after the ball enters a goal. */
  sadTimer: number;

  /* ── Spin visual ── */

  /** Accumulated rotation (radians) used to animate the spin-indicator lines. */
  spinAngle: number;

  /* ── Sticky power-up state ── */

  /** > 0 while the ball is pinned to a sticky paddle; counts down to release. */
  stickyHoldMs: number;

  /** Which paddle currently holds the ball (null when not sticky). */
  stickyOwner: 1 | 2 | null;

  /** Velocity to restore when the sticky paddle releases the ball. */
  stickyVx: number;
  stickyVy: number;

  /* ── Motion trail ── */

  /** Ring buffer of recent ball positions (newest at index 0). */
  trail: TrailPoint[];

  /** Milliseconds since the last trail point was captured. */
  trailTimer: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   VISUAL EFFECTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @interface GoalFlash
 * @description A brief white flash covering one half of the court after a goal.
 *   side 1 = right half flashes (P1 scored).
 *   side 2 = left half flashes  (P2 scored).
 */
export interface GoalFlash
{
  side: 1 | 2;

  /** Milliseconds elapsed since the flash spawned. */
  age: number;
}

/**
 * @interface GoalParticle
 * @description One particle in the burst that plays when a goal is scored.
 *              Particles have velocity, are pulled down by gravity, and fade over time.
 */
export interface GoalParticle
{
  x: number;     // Current position (px)
  y: number;
  vx: number;    // Velocity (px/s)
  vy: number;
  size: number;  // Radius (px)
  age: number;   // ms elapsed — drives alpha fade-out
  color: string; // CSS color string (e.g. '#00f0ff')
}

/**
 * @interface ImpactRing
 * @description An expanding ring that emanates from the ball–paddle contact point.
 *              Starts at radius 0, expands to RING_MAX_RADIUS, then disappears.
 */
export interface ImpactRing
{
  x: number;
  y: number;
  age: number;   // ms elapsed
  color: string;
}

/**
 * @interface WallMark
 * @description A scorch mark burned onto the top or bottom wall when the ball hits.
 *              Fades to invisible over WALL_MARK_FADE_MS milliseconds.
 */
export interface WallMark
{
  x: number;
  y: number;
  age: number;  // ms elapsed
}

/* ═══════════════════════════════════════════════════════════════════════════
   PADDLE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @interface Paddle
 * @description Full state for one paddle — either the human player or the AI.
 *
 * Gameplay state (x, y, vy) is used by the physics and AI systems.
 * Animation state (recoilOffset, emotionOffset, etc.) is used only by the
 * renderer and is purely cosmetic — it does not affect collision detection.
 */
export interface Paddle
{
  /** Left edge X (px). */
  x: number;

  /** Top edge Y (px). */
  y: number;

  /** Canonical X position. recoilOffset is added on top only during rendering. */
  baseX: number;

  width: number;   // px
  height: number;  // px — can temporarily grow with WIDE_PADDLE boost

  /** Vertical velocity (px/s). Positive = moving down. */
  vy: number;

  /** Y from the previous frame — used to compute vy for spin impartment. */
  prevY: number;

  /* ── Spring-based visual animations ── */

  /** Horizontal nudge applied on hit; springs back to zero. */
  recoilOffset: number;
  recoilVelocity: number;

  /** Angle (radians) in the 0.5 Hz idle breathing oscillation. */
  breathPhase: number;

  /** ms remaining for the chromatic-aberration RGB-split flash on hit. */
  chromaticTimer: number;

  /** ms remaining for the blue → orange → blue color flash on hit. */
  colorFlashTimer: number;

  /** Vertical spring offset: paddle jumps up on score, sags on concede. */
  emotionOffset: number;
  emotionVelocity: number;

  /** 1 = left paddle (human), 2 = right paddle (AI). */
  id: 1 | 2;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN SHAKE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @interface ScreenShake
 * @description Drives the camera shake effect triggered by hard hits and goals.
 *
 * Each frame, getShakeOffset() reads this struct to produce a random pixel
 * displacement that decays linearly over `duration` milliseconds.
 */
export interface ScreenShake
{
  /** Maximum random displacement at the start of the shake (px). */
  intensity: number;

  /** Total shake duration (ms). */
  duration: number;

  /** How many ms have already elapsed. */
  elapsed: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GAME STATE
   The single source of truth for all mutable game data.
   The Game class owns one GameState and passes it (or parts of it) to every
   subsystem that needs to read or write game data.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @interface GameState
 * @description The entire mutable state of one match.
 *
 * Everything that changes during gameplay lives here: positions, scores,
 * timers, active effects, and UI animation values.  Keeping it in one object
 * makes it easy to pass to the renderer, physics engine, and AI controller.
 */
export interface GameState
{
  /** Which phase the state machine is currently in. */
  phase: GamePhase;

  ball: Ball;
  player1: Paddle;  // Left side (human)
  player2: Paddle;  // Right side (AI)

  score1: number;  // Points scored by Player 1
  score2: number;  // Points scored by Player 2

  /* ── Active visual effects ── */
  impactRings:   ImpactRing[];
  wallMarks:     WallMark[];
  goalFlashes:   GoalFlash[];
  goalParticles: GoalParticle[];
  shake:         ScreenShake;

  /* ── Rally tracking ── */
  rallyCount:   number;  // Consecutive paddle hits in the current rally
  longestRally: number;  // Highest rally count reached this match

  /* ── Misc flags ── */
  isFirstLaunch: boolean;    // True on very first page load (tutorial hints)
  difficulty:    Difficulty; // Current AI difficulty level

  /* ── UI animation values ── */
  materializeAlpha: number;  // 0→1 fade-in of the ball during POINT_SCORED
  score1Pop:        number;  // Scale factor > 1 just after P1 scores; eases back to 1
  score2Pop:        number;  // Same for P2

  /* ── Wall flash timers ── */
  wallFlashTop:    number;  // ms remaining in the top-wall brightness pulse (0 = idle)
  wallFlashBottom: number;  // ms remaining in the bottom-wall brightness pulse (0 = idle)

  /* ── Power-ups ── */
  powerUps:      PowerUp[];      // Orbs currently on the court
  activeBoosts:  ActiveBoost[];  // Boosts currently active for either player
  lastHitPlayer: 1 | 2;         // Who last hit the ball (determines boost owner on collect)
}
