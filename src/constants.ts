// Single source of truth for all tuning values

// ─── Canvas ───────────────────────────────────────────────────────────────
export const CANVAS_WIDTH  = 960;
export const CANVAS_HEIGHT = 540;
export const TARGET_FPS    = 60;

// ─── Colors ───────────────────────────────────────────────────────────────
export const COLOR_BG          = '#0a0a2e';
export const COLOR_P1          = '#00f0ff';   // cyan
export const COLOR_P2          = '#ff00aa';   // magenta
export const COLOR_BALL        = '#ffffff';
export const COLOR_COURT       = 'rgba(0, 240, 255, 0.18)';
export const COLOR_SPARK       = '#ffe600';

// ─── Ball (velocities in px/s) ────────────────────────────────────────────
export const BALL_RADIUS         = 6;
export const BALL_BASE_SPEED     = 300;   // px/s (≈ 5 px/frame @ 60fps)
export const BALL_SPEED_INC      = 9;     // px/s added per paddle hit
export const BALL_MAX_SPEED      = 720;   // px/s (≈ 12 px/frame)
export const BALL_MAX_ANGLE_DEG  = 60;    // degrees off horizontal for edge hits

// ─── Ball Trail ────────────────────────────────────────────────────────────
export const TRAIL_LENGTH        = 14;    // number of trail points
export const TRAIL_INTERVAL_MS   = 14;    // ms between trail captures

// ─── Paddle ────────────────────────────────────────────────────────────────
export const PADDLE_WIDTH        = 12;    // px
export const PADDLE_HEIGHT       = 80;    // px base
export const PADDLE_BASE_SPEED   = 370;   // px/s max
export const PADDLE_MARGIN       = 30;    // px from canvas edge
export const PADDLE_ACCEL        = 18;    // speed gained per frame (px/s, at 60fps ~ 1080/s²)
export const PADDLE_DECEL        = 0.82;  // velocity multiplier per frame when no input
export const PADDLE_OVERSHOOT    = 0.10;  // fraction of velocity that "bleeds" past stop

// ─── Paddle Breathing ──────────────────────────────────────────────────────
export const BREATH_AMP_PX      = 0.5;   // height oscillation amplitude
export const BREATH_FREQ_HZ     = 0.5;   // oscillation frequency

// ─── Spin ──────────────────────────────────────────────────────────────────
export const SPIN_IMPART_FACTOR  = 0.0028; // paddle vy (px/s) → spin units
export const SPIN_CURVE_FORCE    = 90;     // vy change (px/s) per second per spin unit
export const SPIN_DECAY_PER_S    = 0.35;   // exponential decay constant (per second)
export const SPIN_WALL_RETAIN    = 0.55;   // fraction of spin kept after wall bounce

// ─── Hit Feel ──────────────────────────────────────────────────────────────
export const HITSTOP_SLOW_MS     = 33;    // ~2 frames — slow ball hits
export const HITSTOP_FAST_MS     = 50;    // ~3 frames — fast ball hits
export const HITSTOP_SPEED_THRESHOLD = 520; // px/s: above this → 3-frame hitstop

export const SQUASH_DURATION_MS  = 55;   // duration of squash phase
export const STRETCH_DURATION_MS = 90;   // duration of stretch phase
export const SQUASH_AMOUNT       = 0.65; // scale factor (< 1 = flatten)
export const STRETCH_AMOUNT      = 1.40; // scale factor (> 1 = elongate)

export const PADDLE_RECOIL_PX    = 5;    // px pushed back on hit
export const RECOIL_SPRING_K     = 28;   // spring stiffness
export const RECOIL_SPRING_DAMP  = 0.65; // spring damping per frame

export const CHROMATIC_MS        = 50;   // chromatic aberration flash duration
export const CHROMATIC_OFFSET    = 3;    // px channel offset

// ─── Impact Ring ───────────────────────────────────────────────────────────
export const RING_MAX_RADIUS     = 44;   // px
export const RING_DURATION_MS    = 160;  // ms

// ─── Screen Shake ──────────────────────────────────────────────────────────
export const SHAKE_HIT_INTENSITY = 2;    // px
export const SHAKE_HIT_MS        = 160;
export const SHAKE_GOAL_INTENSITY= 5;    // px
export const SHAKE_GOAL_MS       = 250;

// ─── Neon Glow ─────────────────────────────────────────────────────────────
export const GLOW_PADDLE         = 14;   // shadowBlur radius for paddles
export const GLOW_BALL           = 20;   // shadowBlur radius for ball
export const GLOW_RING           = 8;

// ─── Paddle Emotion ────────────────────────────────────────────────────────
export const EMOTION_JUMP_PX     = -5;   // score: paddle jumps up briefly
export const EMOTION_SAG_PX      = 4;    // concede: paddle sags down
export const EMOTION_SPRING_K    = 18;
export const EMOTION_SPRING_DAMP = 0.6;

// ─── Wall Marks (scorch marks) ────────────────────────────────────────────
export const WALL_MARK_FADE_MS   = 10000; // 10s fade time

// ─── Match / Modes ─────────────────────────────────────────────────────────
export const MATCH_TARGET        = 10;
export const TIME_ATTACK_SECS    = 60;
export const SURVIVAL_LIVES      = 5;

// ─── Serve ─────────────────────────────────────────────────────────────────
export const SERVE_ANGLE_RANGE   = 30;   // ± degrees from horizontal
export const SERVE_COUNTDOWN_MS  = 1000; // after player signals ready
export const SERVE_AUTO_READY_MS = 5000; // PvP auto-serve timeout

// ─── Upgrade Costs (Neon Sparks ⚡) ───────────────────────────────────────
export const COST_WIDE_PADDLE    = 5;
export const COST_SPEED_BOOTS    = 6;
export const COST_STICKY_PADDLE  = 8;
export const COST_TRAIL_BLAZER   = 3;

// ─── Active Ability Cooldowns (ms) ────────────────────────────────────────
export const CD_TURBO_SHOT       = 8000;
export const CD_SLOW_FIELD       = 12000;
export const CD_CURVE_SHOT       = 10000; // replaces Phase Shift per Nintendo review
export const CD_SHIELD_PULSE     = 10000;

// ─── Sparks Economy ────────────────────────────────────────────────────────
export const SPARKS_PER_POINT    = 1;
export const SPARKS_MATCH_WIN    = 3;
export const LONG_RALLY_THRESH   = 10;
export const SPARKS_LONG_RALLY   = 2;
