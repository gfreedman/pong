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
export const COLOR_HIT_FLASH   = '#ff6600';   // orange — paddle color-flash on hit

// ─── Ball (velocities in px/s) ────────────────────────────────────────────
export const BALL_RADIUS         = 12;
export const BALL_BASE_SPEED     = 300;   // px/s (≈ 5 px/frame @ 60fps)
export const BALL_SPEED_INC      = 9;     // px/s added per paddle hit
export const BALL_MAX_SPEED      = 720;   // px/s (≈ 12 px/frame)
export const BALL_MAX_ANGLE_DEG  = 60;    // degrees off horizontal for edge hits

// ─── Ball Trail ────────────────────────────────────────────────────────────
export const TRAIL_LENGTH        = 22;    // max stored trail points (grows with rally)
export const TRAIL_INTERVAL_MS   = 14;    // ms between trail captures

// ─── Paddle ────────────────────────────────────────────────────────────────
export const PADDLE_WIDTH        = 12;    // px
export const PADDLE_HEIGHT       = 80;    // px base
export const PADDLE_BASE_SPEED   = 520;   // px/s max
export const PADDLE_MARGIN       = 30;    // px from canvas edge
export const PADDLE_ACCEL        = 26;    // speed gained per frame (px/s, at 60fps ~ 1560/s²)
// Ease-in decel with Mario-skid shape: paddle carries momentum well at high
// speed, then the decel kicks in through the middle, then drifts gently to
// zero at the end (rather than snapping). Curve exponent controls the shape.
export const PADDLE_DECEL_FAST   = 0.96; // multiplier when near max speed (more carry)
export const PADDLE_DECEL_SLOW   = 0.96; // multiplier when nearly stopped (gentle drift)
export const PADDLE_DECEL_CURVE  = 1.6;  // power curve — >1 = spend longer near FAST
export const PADDLE_OVERSHOOT    = 0.10;  // fraction of velocity that "bleeds" past stop

// ─── Paddle Breathing ──────────────────────────────────────────────────────
export const BREATH_AMP_PX      = 0.5;   // height oscillation amplitude
export const BREATH_FREQ_HZ     = 0.5;   // oscillation frequency

// ─── Spin ──────────────────────────────────────────────────────────────────
export const SPIN_IMPART_FACTOR  = 0.006;  // paddle vy (px/s) → spin units (easier induction)
export const SPIN_CURVE_FORCE    = 90;     // vy change (px/s) per second per spin unit
export const SPIN_DECAY_PER_S    = 0.22;   // exponential decay constant (per second — longer lasting)
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

export const CHROMATIC_MS           = 50;   // chromatic aberration flash duration
export const CHROMATIC_OFFSET       = 3;    // px channel offset
export const PADDLE_COLOR_FLASH_MS  = 180;  // paddle color-flash total duration

// ─── Impact Ring ───────────────────────────────────────────────────────────
export const RING_MAX_RADIUS     = 44;   // px
export const RING_DURATION_MS    = 160;  // ms

// ─── Screen Shake ──────────────────────────────────────────────────────────
export const SHAKE_HIT_INTENSITY = 2;    // px
export const SHAKE_HIT_MS        = 160;
export const SHAKE_GOAL_INTENSITY= 6;    // px
export const SHAKE_GOAL_MS       = 300;

// ─── Neon Glow ─────────────────────────────────────────────────────────────
export const GLOW_PADDLE         = 14;   // shadowBlur radius for paddles
export const GLOW_BALL           = 20;   // shadowBlur radius for ball
export const GLOW_RING           = 8;

// ─── Paddle Emotion ────────────────────────────────────────────────────────
export const EMOTION_JUMP_PX     = -5;   // score: paddle jumps up briefly
export const EMOTION_SAG_PX      = 8;    // concede: paddle sags down
export const EMOTION_SPRING_K    = 18;
export const EMOTION_SPRING_DAMP = 0.6;

// ─── Ball Face Reactions ───────────────────────────────────────────────────
export const HIT_EYE_FLASH_MS    = 67;   // ~4 frames: eye widens after paddle hit
export const BALL_SAD_MS         = 500;  // ms: frown + small eye after goal

// ─── Goal Effects ──────────────────────────────────────────────────────────
export const GOAL_FLASH_MS        = 133;  // 8 frames: half-court white flash
export const GOAL_PARTICLE_MS     = 667;  // 40 frames at 60fps
export const GOAL_PARTICLE_COUNT  = 35;
export const GOAL_PARTICLE_GRAVITY = 150; // px/s²

// ─── Wall Marks (scorch marks) ────────────────────────────────────────────
export const WALL_MARK_FADE_MS   = 10000; // 10s fade time

// ─── Match / Modes ─────────────────────────────────────────────────────────
export const MATCH_TARGET        = 5;
export const TIME_ATTACK_SECS    = 60;
export const SURVIVAL_LIVES      = 5;

// ─── Serve ─────────────────────────────────────────────────────────────────
export const SERVE_ANGLE_RANGE   = 30;   // ± degrees from horizontal
export const SERVE_COUNTDOWN_MS  = 1000; // after player signals ready
export const SERVE_AUTO_READY_MS = 5000; // PvP auto-serve timeout

// ─── Phase Timers ──────────────────────────────────────────────────────────
export const POINT_SCORED_PAUSE_MS = 800; // legacy — replaced by rally-dependent exhale

// ─── Rally Escalation Tiers ───────────────────────────────────────────────
export const RALLY_TIER_BUILDING   = 4;   // hits  4-7:  subtle bass, longer trail
export const RALLY_TIER_INTENSE    = 8;   // hits  8-12: court glows, zoom begins
export const RALLY_TIER_DRAMATIC   = 13;  // hits 13-19: speed lines, warm background
export const RALLY_TIER_LEGENDARY  = 20;  // hits 20+:   edge pulse, max everything

// ─── Breath / Exhale Between Points ──────────────────────────────────────
export const EXHALE_BASE_MS        = 900;  // base pause after every goal
export const EXHALE_PER_RALLY_HIT  = 65;  // extra ms per rally hit (before goal)
export const EXHALE_EXTRA_CAP_MS   = 1500; // cap on extra exhale
export const BALL_MATERIALIZE_MS   = 700;  // ball fades in over this during exhale

// ─── Serve Pending ────────────────────────────────────────────────────────
export const SERVE_PENDING_AI_MS   = 1800; // AI auto-readies after this

// ─── Rally Zoom ───────────────────────────────────────────────────────────
export const ZOOM_INTENSE          = 0.010; // canvas scale delta at intense
export const ZOOM_DRAMATIC         = 0.018; // 1.018×
export const ZOOM_LEGENDARY        = 0.025; // 1.025×

// ─── Legendary Goal ───────────────────────────────────────────────────────
export const LEGENDARY_SHAKE_INTENSITY = 10; // px — bigger shake for legendary rallies
export const LEGENDARY_SHAKE_MS        = 600;

// ─── AI Tuning — Medium (default) ─────────────────────────────────────────
export const AI_SPEED_FACTOR       = 0.85; // fraction of PADDLE_BASE_SPEED AI can reach
export const AI_REACTION_DELAY_MIN = 120;  // ms min between AI target recalculations
export const AI_REACTION_DELAY_MAX = 180;  // ms max between AI target recalculations
export const AI_TARGET_OFFSET_MAX  = 40;   // ±px random error on predicted Y

// ─── AI Tuning — Easy ──────────────────────────────────────────────────────
export const AI_EASY_SPEED_FACTOR       = 0.58;
export const AI_EASY_REACTION_DELAY_MIN = 240;
export const AI_EASY_REACTION_DELAY_MAX = 380;
export const AI_EASY_TARGET_OFFSET_MAX  = 90;

// ─── AI Tuning — Hard ──────────────────────────────────────────────────────
export const AI_HARD_SPEED_FACTOR       = 0.97;
export const AI_HARD_REACTION_DELAY_MIN = 55;
export const AI_HARD_REACTION_DELAY_MAX = 95;
export const AI_HARD_TARGET_OFFSET_MAX  = 6;

// ─── Power-Up Collectibles ────────────────────────────────────────────────
export const POWERUP_SPAWN_MIN_MS   = 8000;   // earliest a new orb spawns after last
export const POWERUP_SPAWN_MAX_MS   = 18000;  // latest a new orb spawns
export const POWERUP_LIFETIME_MS    = 8000;   // orb fades/expires if uncollected
export const POWERUP_BOOST_MS       = 8000;   // boost duration after collection
export const POWERUP_RADIUS         = 20;     // orb collision radius (px)
export const POWERUP_WIDE_FACTOR    = 1.5;    // paddle height multiplier
export const POWERUP_SPEED_FACTOR   = 1.4;   // paddle max-speed multiplier
export const POWERUP_TRAIL_FACTOR   = 3.0;   // trail length/brightness multiplier
export const POWERUP_STICKY_HOLD_MS  = 500;   // ms ball is held on sticky paddle
export const POWERUP_SPEED_ACCEL_FACTOR = 1.5; // extra acceleration multiplier for SPEED_BOOTS
export const POWERUP_TRAIL_SPEED_BONUS  = 25;  // px/s added to ball on each hit with TRAIL_BLAZER

export const COLOR_POWERUP_WIDE    = '#44ff88';  // green
export const COLOR_POWERUP_SPEED   = '#ffe600';  // yellow
export const COLOR_POWERUP_STICKY  = '#ff00aa';  // magenta
export const COLOR_POWERUP_TRAIL   = '#00f0ff';  // cyan

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
