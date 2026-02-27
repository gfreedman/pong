// All shared types, interfaces, and enums for Neon Pong

export type GamePhase =
  | 'PLAYING'
  | 'PAUSED'
  | 'MENU'
  | 'MODE_SELECT'
  | 'DIFFICULTY_SELECT'
  | 'SIDE_SELECT'
  | 'POINT_SCORED'
  | 'SERVE_PENDING'
  | 'SERVING'
  | 'MATCH_END'
  | 'UPGRADE_SHOP';

export type GameMode = 'QUICK_PLAY' | 'MATCH' | 'TIME_ATTACK' | 'SURVIVAL';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type PlayerSide = 'LEFT' | 'RIGHT';

export interface TrailPoint {
  x: number;
  y: number;
}

export interface ImpactRing {
  x: number;
  y: number;
  age: number;    // ms elapsed since spawn
  color: string;
}

export interface WallMark {
  x: number;
  y: number;
  age: number;    // ms elapsed — fades over 10s
}

export interface Ball {
  x: number;
  y: number;
  vx: number;     // px/s
  vy: number;     // px/s
  spin: number;   // positive = topspin (curves ball down)
  radius: number;
  speed: number;  // current speed magnitude in px/s

  // Hit-feel timers (ms)
  hitstopTimer: number;
  squashTimer: number;
  stretchTimer: number;

  // Face expression timers (ms)
  hitFlashTimer: number;  // eye widens 1.3x for ~4 frames after paddle hit
  sadTimer: number;       // frown + small eye (0.8x) for 500ms after goal

  // Spin visual accumulator — driven by spin magnitude, used to rotate spin lines
  spinAngle: number;  // radians

  // Trail history (newest first)
  trail: TrailPoint[];
  trailTimer: number; // ms since last trail point captured
}

export interface GoalFlash {
  side: 1 | 2;  // 1 = P1 scored (right half flashes), 2 = P2 scored (left half flashes)
  age: number;  // ms elapsed
}

export interface GoalParticle {
  x: number;
  y: number;
  vx: number;    // px/s
  vy: number;    // px/s
  size: number;  // radius px
  age: number;   // ms elapsed
  color: string;
}

export interface Paddle {
  x: number;
  y: number;
  baseX: number;        // canonical X; recoil is a visual offset
  width: number;
  height: number;
  vy: number;           // current velocity (px/s)
  prevY: number;        // y from previous frame (for spin calculation)

  // Visual/animation state
  recoilOffset: number;     // spring-based horizontal recoil (px)
  recoilVelocity: number;   // spring velocity
  breathPhase: number;      // radians (idle breathing oscillation)
  chromaticTimer: number;   // ms remaining for chromatic-aberration flash
  colorFlashTimer: number;  // ms remaining for hit color flash (base → orange → base)
  emotionOffset: number;    // px vertical sag/jump on goal (eases to 0)
  emotionVelocity: number;  // spring velocity for emotion

  id: 1 | 2;
}

export interface ScreenShake {
  intensity: number;  // px
  duration: number;   // ms total
  elapsed: number;    // ms elapsed
}

export interface GameState {
  phase: GamePhase;
  ball: Ball;
  player1: Paddle;
  player2: Paddle;
  score1: number;
  score2: number;
  impactRings: ImpactRing[];
  wallMarks: WallMark[];
  goalFlashes: GoalFlash[];
  goalParticles: GoalParticle[];
  shake: ScreenShake;
  rallyCount: number;
  longestRally: number;
  isFirstLaunch: boolean;   // Nintendo first-launch experience flag

  // Phase 3 — rhythm
  materializeAlpha: number;  // 0 → 1: ball fades in during exhale phase
  score1Pop: number;         // > 1: score number scale bounce, eases back to 1
  score2Pop: number;
}
