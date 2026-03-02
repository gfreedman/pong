/**
 * @file game.ts
 * @description Game — state machine, game loop, and orchestration for Neon Pong.
 *
 * RESPONSIBILITY
 * --------------
 * The Game class is the top-level controller.  It owns:
 *   - The single GameState object (all mutable game data).
 *   - The RAF (requestAnimationFrame) game loop.
 *   - All phase transitions in the finite state machine.
 *   - Coordination between subsystems (physics, renderer, audio, AI, input).
 *   - DOM overlay management (difficulty select, end screen, pause modal).
 *
 * FINITE STATE MACHINE
 * --------------------
 * The game is always in exactly one GamePhase.  Legal transitions:
 *
 *   DIFFICULTY_SELECT → POINT_SCORED (on difficulty confirmed)
 *   POINT_SCORED      → SERVE_PENDING (after exhale timer)
 *   SERVE_PENDING     → SERVING (on player key press or AI auto-ready)
 *   SERVING           → PLAYING (after 3-2-1 countdown)
 *   PLAYING           → POINT_SCORED (on goal)
 *   PLAYING           → MATCH_END (when a player reaches MATCH_TARGET)
 *   MATCH_END         → DIFFICULTY_SELECT or POINT_SCORED (via end overlay)
 *   Any in-game phase ↔ PAUSED (Escape key toggles)
 *
 * GAME LOOP
 * ---------
 * Each frame (via requestAnimationFrame):
 *   1. Compute deltaMs (capped at 80ms to prevent spiral-of-death on tab switch).
 *   2. update(deltaMs) — advance state machine, physics, timers.
 *   3. render()        — draw current state to canvas.
 *   4. input.flush()   — clear single-frame input events.
 */

import
{
  Ball, Paddle, GameState, GamePhase, ImpactRing, WallMark, ScreenShake,
  GoalFlash, GoalParticle, Difficulty, PowerUp, PowerUpType, ActiveBoost
} from './types.js';
import
{
  CANVAS_WIDTH, CANVAS_HEIGHT,
  BALL_RADIUS, BALL_BASE_SPEED, BALL_MAX_SPEED,
  PADDLE_WIDTH, PADDLE_HEIGHT, PADDLE_BASE_SPEED, PADDLE_MARGIN,
  PADDLE_ACCEL, PADDLE_DECEL_FAST, PADDLE_DECEL_SLOW, PADDLE_DECEL_CURVE,
  COLOR_P1, COLOR_P2,
  SHAKE_HIT_INTENSITY, SHAKE_HIT_MS,
  SHAKE_GOAL_INTENSITY, SHAKE_GOAL_MS,
  BALL_SAD_MS,
  SERVE_COUNTDOWN_MS,
  MATCH_TARGET,
  RALLY_TIER_BUILDING, RALLY_TIER_INTENSE, RALLY_TIER_DRAMATIC, RALLY_TIER_LEGENDARY,
  EXHALE_BASE_MS, EXHALE_PER_RALLY_HIT, EXHALE_EXTRA_CAP_MS,
  BALL_MATERIALIZE_MS,
  SERVE_PENDING_AI_MS,
  LEGENDARY_SHAKE_INTENSITY, LEGENDARY_SHAKE_MS,
  POWERUP_SPAWN_MIN_X, POWERUP_SPAWN_MAX_X, POWERUP_SPAWN_MIN_Y, POWERUP_SPAWN_MAX_Y,
  POWERUP_SPAWN_MIN_MS, POWERUP_SPAWN_MAX_MS, POWERUP_LIFETIME_MS,
  POWERUP_BOOST_MS, POWERUP_RADIUS, POWERUP_WIDE_FACTOR, POWERUP_SPEED_FACTOR,
  POWERUP_STICKY_HOLD_MS, POWERUP_SPEED_ACCEL_FACTOR, POWERUP_TRAIL_SPEED_BONUS,
  COLOR_POWERUP_WIDE, COLOR_POWERUP_SPEED, COLOR_POWERUP_STICKY, COLOR_POWERUP_TRAIL,
  GOAT_PADDLE_HEIGHT, GOAT_SPIN_AMOUNT, GOAT_SPEED_MULT, GOAT_BALL_MAX_SPEED,
  WALL_FLASH_MS,
  SAFE_INSET_LEFT_PX, SAFE_INSET_RIGHT_PX,
} from './constants.js';
import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { Renderer }     from './renderer.js';
import { AIController } from './ai.js';
import
{
  updateBall, updatePaddleAnimations, resetBall,
  spawnImpactRing, updateImpactRings,
  spawnWallMark, updateWallMarks,
  updateScreenShake, triggerShake, getShakeOffset,
  triggerPaddleEmotion,
  spawnGoalFlash, updateGoalFlashes,
  spawnGoalParticles, updateGoalParticles,
} from './physics.js';

/* ═══════════════════════════════════════════════════════════════════════════
   FACTORY HELPERS
   Small functions that construct initial-state objects.
   Using factories (rather than inline object literals) makes startMatch()
   easy to read and guarantees consistent initial state on every reset.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @function makeBall
 * @description Creates a ball at rest at the center of the court.
 *              The ball is not moving; resetBall() or the SERVING phase will
 *              set its velocity before it enters play.
 * @returns {Ball} Fresh ball object with all timers zeroed.
 */
function makeBall(): Ball
{
  return {
    x: CANVAS_WIDTH  / 2,
    y: CANVAS_HEIGHT / 2,
    vx: 0,
    vy: 0,
    spin:      0,
    spinAngle: 0,
    radius:    BALL_RADIUS,
    speed:     BALL_BASE_SPEED,
    hitstopTimer:  0,
    squashTimer:   0,
    stretchTimer:  0,
    hitFlashTimer: 0,
    sadTimer:      0,
    stickyHoldMs:  0,
    stickyOwner:   null,
    stickyVx: 0,
    stickyVy: 0,
    trail:       [],
    trailTimer:  0,
  };
}

/**
 * @function makePaddle
 * @description Creates a paddle centered vertically on the correct side of the court.
 *              P1 (side=1) is placed at PADDLE_MARGIN from the left.
 *              P2 (side=2) is placed at PADDLE_MARGIN from the right.
 *
 * @param side  1 = left/human, 2 = right/AI.
 * @returns {Paddle} Fresh paddle object.
 */
function makePaddle(side: 1 | 2): Paddle
{
  const x = side === 1
    ? PADDLE_MARGIN + SAFE_INSET_LEFT_PX
    : CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH - SAFE_INSET_RIGHT_PX;

  return {
    x,
    y:         (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2,
    baseX:     x,
    width:     PADDLE_WIDTH,
    height:    PADDLE_HEIGHT,
    vy:        0,
    prevY:     (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2,
    recoilOffset:   0,
    recoilVelocity: 0,
    breathPhase:    side === 2 ? Math.PI : 0, // P2 starts half a breath out of phase
    chromaticTimer: 0,
    colorFlashTimer: 0,
    emotionOffset:   0,
    emotionVelocity: 0,
    id: side,
  };
}

/**
 * @function makeShake
 * @description Creates an at-rest ScreenShake object (no shake active).
 * @returns {ScreenShake} Zero-state screen shake.
 */
function makeShake(): ScreenShake
{
  return { intensity: 0, duration: 0, elapsed: 0 };
}

/* ═══════════════════════════════════════════════════════════════════════════
   GAME CLASS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @class Game
 * @description Top-level game controller.
 *
 * Instantiate once, then call start() to begin the game loop.
 * The canvas element is passed in from main.ts, which scales it to viewport.
 */
export class Game
{
  /* ── Subsystems ─────────────────────────────────────────────────────────
     Each subsystem has a single responsibility:
       input    — keyboard state (reading only, never written)
       audio    — all sound synthesis
       renderer — all canvas drawing (reading state, writing pixels)
       ai       — drives P2 paddle movement                          */
  private state:    GameState;
  private input:    InputManager;
  private audio:    AudioManager;
  private renderer: Renderer;
  private ai:       AIController;

  /* ── Game loop ───────────────────────────────────────────────────────── */

  /** Timestamp from the previous requestAnimationFrame call (ms). */
  private lastTimestamp = 0;

  /** requestAnimationFrame ID — used by stop() to cancel the loop. */
  private rafId = 0;

  /* ── Power-up state ──────────────────────────────────────────────────── */

  /** Accumulated ms since last orb spawn. */
  private powerUpTimer    = 0;

  /** Randomized wait between 8–18s — reset each spawn cycle. */
  private powerUpInterval = 0;

  /** Monotonically increasing ms counter — used for boost expiry timestamps. */
  private gameTime        = 0;

  /** Counter for giving each orb a unique ID. */
  private powerUpIdCtr    = 0;

  /* ── Spin discovery tracking ─────────────────────────────────────────── */

  /** Rally hits in the current serve (resets on goal). */
  private rallyHits = 0;

  /** True once the spin discovery label has been shown this match. */
  private spinDiscoveryShown = false;

  /** ms remaining for the "✧ SPIN ✧" label display. */
  private spinDiscoveryTimer = 0;

  /* ── Phase timers ────────────────────────────────────────────────────── */

  /** POINT_SCORED: ms remaining in the exhale pause (counts down). */
  private phaseTimer = 0;

  /** SERVE_PENDING: ms elapsed since entering this phase (counts up). */
  private servePendingTimer = 0;

  /** SERVING: ms remaining for the current countdown step. */
  private countdownTimer = 0;

  /** SERVING: which step we're on (3 → 2 → 1 → launch). */
  private countdownStep = 3;

  /* ── End screen ─────────────────────────────────────────────────────── */

  /** Currently highlighted end-screen option index (0 = Rematch, 1 = Main Menu). */
  private endScreenIndex = 0;

  /* ── Serve direction ─────────────────────────────────────────────────── */

  /**
   * true = ball will be served toward P1 (left).
   * After a goal: the player who conceded receives the serve.
   */
  private servingToward = true;

  /* ── Rally drone tier management ─────────────────────────────────────── */

  /** Most recently applied drone tier (0–4). Used to avoid redundant calls. */
  private currentDroneTier = 0;

  /* ── Difficulty select ───────────────────────────────────────────────── */

  /** Current difficulty level. Set when the player confirms on the overlay. */
  private difficulty: Difficulty = 'MEDIUM';

  /** Selected index in the difficulty list: 0=Easy, 1=Medium, 2=Hard. */
  private difficultyIndex = 1;

  /* ── God Mode ────────────────────────────────────────────────────────── */

  /** When true, P1 always has all power-ups active at full strength. */
  private godMode = false;

  /* ── GOAT Mode (secret) ──────────────────────────────────────────────── */

  /** When true: P1 paddle = half-screen, every P1 hit → super spin + 4× speed. */
  private goatMode = false;

  /** Rising-edge latch: prevents the toggle firing every frame while keys are held. */
  private goatKeysWereAllDown = false;

  /* ── Canvas reference ───────────────────────────────────────────────── */

  /** Kept so we can request fullscreen and pass to renderer.handleResize(). */
  private canvas: HTMLCanvasElement;

  /* ── HTML overlay DOM references ─────────────────────────────────────── */

  private difficultyOverlay!: HTMLElement;
  private endOverlay!:        HTMLElement;
  private pauseOverlay!:      HTMLElement;
  private pauseBtn!:          HTMLElement;
  private howToPlayOverlay!:  HTMLElement;

  /* ── Pause state ─────────────────────────────────────────────────────── */

  /** The phase to restore when the player resumes from pause. */
  private prePausePhase: GamePhase = 'PLAYING';

  /** Currently highlighted pause-menu option index (0 = Resume, 1 = Restart, 2 = Quit). */
  private pauseIndex = 0;

  /* ── Constructor ─────────────────────────────────────────────────────── */

  /**
   * @constructor
   * @description Initializes all subsystems, builds initial GameState, wires
   *              up DOM overlay event listeners, and shows the difficulty overlay.
   *
   * @param canvas  The <canvas> element; passed to Renderer for DPR scaling.
   */
  constructor(canvas: HTMLCanvasElement)
  {
    this.canvas   = canvas;
    this.input    = new InputManager();
    this.input.attachTouch(canvas);
    this.audio    = new AudioManager();
    this.renderer = new Renderer(canvas);
    this.ai       = new AIController();

    /* ── Initial GameState ────────────────────────────────────────────────
       The game starts in DIFFICULTY_SELECT so the HTML overlay is shown
       immediately.  No ball or paddle movement happens in this phase.   */
    this.state =
    {
      phase:    'DIFFICULTY_SELECT',
      ball:     makeBall(),
      player1:  makePaddle(1),
      player2:  makePaddle(2),
      score1:   0,
      score2:   0,
      impactRings:   [],
      wallMarks:     [],
      goalFlashes:   [],
      goalParticles: [],
      shake:         makeShake(),
      rallyCount:    0,
      longestRally:  0,
      isFirstLaunch: true,
      difficulty:    'MEDIUM',
      materializeAlpha: 0,
      score1Pop: 1,
      score2Pop: 1,
      wallFlashTop:    0,
      wallFlashBottom: 0,
      powerUps:     [],
      activeBoosts: [],
      lastHitPlayer: 1,
    };

    /* ── DOM references ── */
    this.difficultyOverlay = document.getElementById('difficulty-overlay')!;
    this.endOverlay        = document.getElementById('end-overlay')!;
    this.pauseOverlay      = document.getElementById('pause-overlay')!;
    this.pauseBtn          = document.getElementById('pause-btn')!;
    this.howToPlayOverlay  = document.getElementById('howtoplay-overlay')!;

    /* Pause button (top-right corner during gameplay). */
    this.pauseBtn.addEventListener('click', () => this.pauseGame());

    /* God Mode checkbox (debug/fun feature). */
    const godModeCheckbox = document.getElementById('god-mode-checkbox') as HTMLInputElement;
    godModeCheckbox.addEventListener('change', () =>
    {
      this.godMode = godModeCheckbox.checked;
    });

    this.setupOverlayEvents();
    this.showDifficultyOverlay();

    /* Resize the renderer whenever the browser enters or exits fullscreen.
       Handles both the standard API and Safari's webkit-prefixed version.  */
    const onFullscreenChange = (): void =>
    {
      const fsEl = document.fullscreenElement
        ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (fsEl) this.renderer.handleResize(this.canvas);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  }

  /* ── Public lifecycle ──────────────────────────────────────────────── */

  /**
   * @method start
   * @description Kicks off the requestAnimationFrame loop.
   *              Call once after construction.
   */
  start(): void
  {
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  /**
   * @method stop
   * @description Cancels the RAF loop.  Used for cleanup / testing.
   */
  stop(): void
  {
    cancelAnimationFrame(this.rafId);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MAIN LOOP
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method loop
   * @description The requestAnimationFrame callback.  Runs once per frame.
   *
   *              deltaMs is capped at 80ms to prevent the "spiral of death"
   *              where a long frame causes large physics steps that cause more
   *              issues, leading to more long frames.
   *
   * @param timestamp  High-resolution timestamp from the browser (ms since page load).
   */
  private loop(timestamp: number): void
  {
    /* Cap delta to 80ms (≈ 12fps minimum) so a backgrounded tab doesn't
       cause a giant physics jump when the player tabs back in.           */
    const deltaMs = Math.min(timestamp - this.lastTimestamp, 80);
    this.lastTimestamp = timestamp;

    this.update(deltaMs);
    this.render();

    /* Flush single-frame input events AFTER update and render. */
    this.input.flush();

    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     UPDATE DISPATCH
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method update
   * @description Routes the current frame to the appropriate phase handler,
   *              then runs global per-frame updates that apply in every phase.
   *
   * @param deltaMs  Milliseconds since last frame.
   */
  private update(deltaMs: number): void
  {
    const { state } = this;

    /* ── Global Escape key: toggle pause from any in-game phase ───────── */
    if (this.input.pause())
    {
      if (state.phase === 'PAUSED')
      {
        this.resumeGame();
        return;
      }

      const pauseable: GamePhase[] = ['PLAYING', 'SERVE_PENDING', 'SERVING', 'POINT_SCORED'];
      if (pauseable.includes(state.phase))
      {
        this.pauseGame();
        return;
      }
    }

    /* ── GOAT mode toggle: hold G + O + A + T simultaneously ───────────
       Rising-edge detection prevents the flag from flipping every frame. */
    const goatAllDown =
      this.input.isDown('g') && this.input.isDown('o') &&
      this.input.isDown('a') && this.input.isDown('t');
    if (goatAllDown && !this.goatKeysWereAllDown)
    {
      this.goatMode = !this.goatMode;
    }
    this.goatKeysWereAllDown = goatAllDown;

    /* ── Phase dispatch ─────────────────────────────────────────────────
       Each phase has its own handler.  DIFFICULTY_SELECT and MATCH_END
       are pure menu phases; others run gameplay logic.                  */
    switch (state.phase)
    {
      case 'DIFFICULTY_SELECT':
        this.tickDifficultySelect();
        return; // skip global updates while on menu (no physics/effects)

      case 'PAUSED':
        this.tickPaused();
        break;

      case 'PLAYING':
        this.gameTime += deltaMs;
        this.updatePaddleMovement(deltaMs);
        this.ai.update(state.player2, state.ball, deltaMs);
        this.applyPaddleBoosts(deltaMs);
        this.updateAnimations(deltaMs);
        this.tickPowerUps(deltaMs);
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

    /* ── Global per-frame updates ───────────────────────────────────────
       These run every frame regardless of phase (except DIFFICULTY_SELECT
       which returns early above).                                        */

    this.tickScorePops(deltaMs);
    updateImpactRings(state.impactRings, deltaMs);
    updateWallMarks(state.wallMarks, deltaMs);
    updateGoalFlashes(state.goalFlashes, deltaMs);
    updateGoalParticles(state.goalParticles, deltaMs);
    updateScreenShake(state.shake, deltaMs);
    this.audio.tick(deltaMs);

    /* Spin discovery label fade-out timer. */
    if (this.spinDiscoveryTimer > 0)
    {
      this.spinDiscoveryTimer = Math.max(0, this.spinDiscoveryTimer - deltaMs);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PHASE TICK HANDLERS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method tickPointScored
   * @description Handles the POINT_SCORED (exhale) phase.
   *
   *              During this phase:
   *                - The ball is frozen at center and fades in from transparent.
   *                - Paddles slide toward the center.
   *                - A timer counts down; on expiry → SERVE_PENDING.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private tickPointScored(deltaMs: number): void
  {
    /* Animate ball fade-in from invisible → visible over BALL_MATERIALIZE_MS. */
    this.state.materializeAlpha = Math.min(
      1,
      this.state.materializeAlpha + deltaMs / BALL_MATERIALIZE_MS
    );

    /* Count down the exhale timer. */
    this.phaseTimer -= deltaMs;
    if (this.phaseTimer <= 0)
    {
      this.state.phase      = 'SERVE_PENDING';
      this.servePendingTimer = 0;
    }
  }

  /**
   * @method tickServePending
   * @description Handles the SERVE_PENDING phase.
   *
   *              Waits for either:
   *                - The human player to press W/S/ArrowUp/ArrowDown (signal ready).
   *                - The AI auto-ready timer to expire (SERVE_PENDING_AI_MS).
   *              On ready → SERVING (begins 3-2-1 countdown).
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private tickServePending(deltaMs: number): void
  {
    this.servePendingTimer += deltaMs;

    const playerReady = this.input.p1Up() || this.input.p1Down() || this.input.confirm();
    const aiReady     = this.servePendingTimer >= SERVE_PENDING_AI_MS;

    if (playerReady || aiReady)
    {
      this.state.phase    = 'SERVING';
      this.countdownStep  = 3;
      this.countdownTimer = SERVE_COUNTDOWN_MS;
      this.audio.playCountdownBeep(0); // "3" — low beep
    }
  }

  /**
   * @method tickServing
   * @description Handles the SERVING phase (3-2-1 countdown).
   *
   *              Each step lasts SERVE_COUNTDOWN_MS milliseconds.
   *              When countdownStep reaches 0 → launch ball → PLAYING.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private tickServing(deltaMs: number): void
  {
    this.countdownTimer -= deltaMs;

    if (this.countdownTimer <= 0)
    {
      this.countdownStep--;

      if (this.countdownStep > 0)
      {
        /* Still counting down — play next beep and reset the step timer. */
        this.countdownTimer = SERVE_COUNTDOWN_MS;
        /* beepIndex: step 2 → index 1 ("2"); step 1 → index 2 ("GO!" high beep). */
        this.audio.playCountdownBeep(this.countdownStep === 1 ? 2 : 1);
      }
      else
      {
        /* Countdown complete — launch the ball and start playing. */
        resetBall(this.state.ball, this.servingToward);
        this.state.phase = 'PLAYING';
      }
    }
  }

  /**
   * @method tickDifficultySelect
   * @description Handles keyboard navigation in the DIFFICULTY_SELECT overlay.
   *              Arrow keys / W/S cycle through options; Enter/Space confirms.
   */
  private tickDifficultySelect(): void
  {
    const DIFFS = 3; // number of difficulty options

    if (this.input.menuUp())
    {
      this.difficultyIndex = (this.difficultyIndex - 1 + DIFFS) % DIFFS;
      this.setDifficultySelection(this.difficultyIndex);
      this.audio.playMenuNav();
    }
    if (this.input.menuDown())
    {
      this.difficultyIndex = (this.difficultyIndex + 1) % DIFFS;
      this.setDifficultySelection(this.difficultyIndex);
      this.audio.playMenuNav();
    }
    if (this.input.confirm())
    {
      this.confirmDifficulty();
    }
  }

  /**
   * @method tickMatchEnd
   * @description Handles keyboard navigation in the MATCH_END end-screen overlay.
   *              Arrow keys / W/S cycle between Rematch and Main Menu; Enter/Space confirms.
   */
  private tickMatchEnd(): void
  {
    const OPTIONS = 2; // Rematch (0) and Main Menu (1)

    if (this.input.menuUp())
    {
      this.endScreenIndex = (this.endScreenIndex - 1 + OPTIONS) % OPTIONS;
      this.setEndSelection(this.endScreenIndex);
      this.audio.playMenuNav();
    }
    if (this.input.menuDown())
    {
      this.endScreenIndex = (this.endScreenIndex + 1) % OPTIONS;
      this.setEndSelection(this.endScreenIndex);
      this.audio.playMenuNav();
    }
    if (this.input.confirm())
    {
      this.handleEndConfirm();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     HTML OVERLAY MANAGEMENT
     The three HTML overlays (difficulty, end, pause) are shown/hidden by
     toggling CSS classes and aria-hidden attributes.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method setupOverlayEvents
   * @description Wires click event listeners to all overlay buttons.
   *              Called once in the constructor.
   */
  private setupOverlayEvents(): void
  {
    /* ── Difficulty buttons — click selects AND confirms (no two-step) ── */
    this.difficultyOverlay.querySelectorAll<HTMLElement>('.btn-diff[data-diff]').forEach(btn =>
    {
      btn.addEventListener('click', () =>
      {
        this.difficultyIndex = parseInt(btn.dataset.diff!);
        this.confirmDifficulty();
      });
    });

    /* ── End-screen buttons ── */
    this.endOverlay.querySelectorAll<HTMLElement>('.btn-end').forEach(btn =>
    {
      btn.addEventListener('click', () =>
      {
        this.endScreenIndex = parseInt(btn.dataset.end!);
        this.handleEndConfirm();
      });
    });

    /* ── How To Play modal ── */
    const howToPlayBtn   = document.getElementById('how-to-play-btn')!;
    const howToPlayClose = document.getElementById('htp-close')!;

    /** Open the How To Play modal and shift focus into it. */
    const openHowToPlay = (): void =>
    {
      this.howToPlayOverlay.classList.add('active');
      this.howToPlayOverlay.setAttribute('aria-hidden', 'false');
      /* Move focus to the close button so keyboard users can dismiss immediately. */
      howToPlayClose.focus();
    };

    /** Close the How To Play modal. */
    const closeHowToPlay = (): void =>
    {
      this.howToPlayOverlay.classList.remove('active');
      this.howToPlayOverlay.setAttribute('aria-hidden', 'true');
      /* Return focus to the link that opened the modal. */
      howToPlayBtn.focus();
    };

    howToPlayBtn.addEventListener('click', openHowToPlay);
    howToPlayClose.addEventListener('click', closeHowToPlay);

    /* Click on the backdrop (not the card) also closes the modal. */
    this.howToPlayOverlay.addEventListener('click', (e) =>
    {
      if (e.target === this.howToPlayOverlay) closeHowToPlay();
    });

    /* Escape closes the modal when it is open (before the game loop consumes it). */
    window.addEventListener('keydown', (e) =>
    {
      if (e.key === 'Escape' && this.howToPlayOverlay.classList.contains('active'))
      {
        e.stopPropagation(); // prevent the game-loop pause handler from firing too
        closeHowToPlay();
      }
    }, { capture: true });

    /* ── Pause-modal buttons ── */
    this.pauseOverlay.querySelectorAll<HTMLElement>('.btn-pause').forEach(btn =>
    {
      btn.addEventListener('click', () =>
      {
        const idx = parseInt(btn.dataset.pause!);
        this.audio.playMenuConfirm();

        if (idx === 0)
        {
          /* Resume */
          this.resumeGame();
        }
        else if (idx === 1)
        {
          /* Restart match */
          this.pauseOverlay.classList.remove('active');
          this.pauseOverlay.setAttribute('aria-hidden', 'true');
          this.resetMatch();
        }
        else
        {
          /* Quit to menu */
          this.pauseOverlay.classList.remove('active');
          this.audio.setRallyDrone(0);
          this.currentDroneTier = 0;
          this.state.phase      = 'DIFFICULTY_SELECT';
          this.pauseBtn.classList.add('hidden');
          this.showDifficultyOverlay();
        }
      });
    });
  }

  /**
   * @method pauseGame
   * @description Transitions into the PAUSED phase.
   *              Saves the pre-pause phase so resume can restore it.
   *              Shows the pause modal overlay.
   */
  private pauseGame(): void
  {
    this.prePausePhase = this.state.phase;
    this.state.phase   = 'PAUSED';
    this.pauseIndex    = 0;
    this.setPauseSelection(0);
    this.pauseOverlay.classList.add('active');
    this.pauseOverlay.setAttribute('aria-hidden', 'false');
  }

  /**
   * @method resumeGame
   * @description Restores the pre-pause phase and hides the pause overlay.
   */
  private resumeGame(): void
  {
    this.state.phase = this.prePausePhase;
    this.pauseOverlay.classList.remove('active');
    this.pauseOverlay.setAttribute('aria-hidden', 'true');
  }

  /**
   * @method tickPaused
   * @description Handles keyboard navigation while paused.
   *              Same W/S / Arrow keys as other menus; Enter/Space confirms.
   */
  private tickPaused(): void
  {
    const OPTIONS = 3; // Resume (0), Restart (1), Quit (2)

    if (this.input.menuUp())
    {
      this.pauseIndex = (this.pauseIndex - 1 + OPTIONS) % OPTIONS;
      this.setPauseSelection(this.pauseIndex);
      this.audio.playMenuNav();
    }
    if (this.input.menuDown())
    {
      this.pauseIndex = (this.pauseIndex + 1) % OPTIONS;
      this.setPauseSelection(this.pauseIndex);
      this.audio.playMenuNav();
    }
    if (this.input.confirm())
    {
      this.audio.playMenuConfirm();

      if (this.pauseIndex === 0)
      {
        this.resumeGame();
      }
      else if (this.pauseIndex === 1)
      {
        /* Restart: close overlay, reset. */
        this.pauseOverlay.classList.remove('active');
        this.pauseOverlay.setAttribute('aria-hidden', 'true');
        this.resetMatch();
      }
      else
      {
        /* Quit to menu. */
        this.pauseOverlay.classList.remove('active');
        this.audio.setRallyDrone(0);
        this.currentDroneTier = 0;
        this.state.phase      = 'DIFFICULTY_SELECT';
        this.pauseBtn.classList.add('hidden');
        this.showDifficultyOverlay();
      }
    }
  }

  /**
   * @method setPauseSelection
   * @description Updates the CSS 'selected' class on pause menu buttons.
   * @param index  The button index to mark as selected (0, 1, or 2).
   */
  private setPauseSelection(index: number): void
  {
    this.pauseOverlay.querySelectorAll('.btn-pause').forEach((btn, i) =>
    {
      btn.classList.toggle('selected', i === index);
    });
  }

  /**
   * @method confirmDifficulty
   * @description Called when the player selects a difficulty.
   *              Configures the AI, hides the overlay, and starts the match.
   */
  private confirmDifficulty(): void
  {
    const diffs: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
    this.difficulty = diffs[this.difficultyIndex];
    this.ai.configure(this.difficulty);
    this.audio.playMenuConfirm();
    this.hideDifficultyOverlay();

    /* On touch devices request fullscreen — must be called inside a user
       gesture handler (click / Enter), which it always is here.
       The fullscreenchange listener in the constructor calls handleResize
       once the browser finishes the transition.
       startMatch() runs immediately; the first frames render at the old
       size then snap to fullscreen when the event fires (~100 ms).
       iOS Safari ignores requestFullscreen silently — the 100dvh CSS rule
       is the fallback for that platform.                                 */
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches)
    {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
      req?.call(el)?.catch?.(() => { /* declined — no-op */ });
    }

    this.startMatch();
  }

  /**
   * @method handleEndConfirm
   * @description Called when the player confirms a selection on the end screen.
   *              Index 0 = Rematch; Index 1 = Main Menu.
   */
  private handleEndConfirm(): void
  {
    this.audio.playMenuConfirm();
    this.hideEndOverlay();

    if (this.endScreenIndex === 1)
    {
      /* Main Menu — show difficulty overlay. */
      this.state.phase = 'DIFFICULTY_SELECT';
      this.showDifficultyOverlay();
    }
    else
    {
      /* Rematch — restart with the same difficulty. */
      this.resetMatch();
    }
  }

  /** Show the difficulty-select overlay and hide the pause button. */
  private showDifficultyOverlay(): void
  {
    this.pauseBtn.classList.add('hidden');
    this.setDifficultySelection(this.difficultyIndex);
    this.difficultyOverlay.classList.add('active');
    this.difficultyOverlay.setAttribute('aria-hidden', 'false');
  }

  /** Hide the difficulty-select overlay. */
  private hideDifficultyOverlay(): void
  {
    this.difficultyOverlay.classList.remove('active');
    this.difficultyOverlay.setAttribute('aria-hidden', 'true');
  }

  /**
   * @method showEndOverlay
   * @description Populates and shows the end-screen overlay.
   *
   * @param winner        Display text, e.g. "PLAYER WINS!" or "AI WINS!".
   * @param score1        P1 final score.
   * @param score2        P2 final score.
   * @param longestRally  Longest rally in the match (hits).
   */
  private showEndOverlay(
    winner:        string,
    score1:        number,
    score2:        number,
    longestRally:  number
  ): void
  {
    this.pauseBtn.classList.add('hidden');

    /* Populate DOM elements with match results. */
    const winnerEl       = document.getElementById('end-winner')!;
    winnerEl.textContent = winner;
    winnerEl.className   = 'end-winner ' + (winner === 'PLAYER WINS!' ? 'player-wins' : 'ai-wins');

    document.getElementById('end-score')!.textContent = `${score1}  —  ${score2}`;
    document.getElementById('end-stats')!.innerHTML   =
      `<span>Longest Rally: ${longestRally} hits</span>`;

    this.endScreenIndex = 0;
    this.setEndSelection(0);
    this.endOverlay.classList.add('active');
    this.endOverlay.setAttribute('aria-hidden', 'false');
  }

  /** Hide the end-screen overlay. */
  private hideEndOverlay(): void
  {
    this.endOverlay.classList.remove('active');
    this.endOverlay.setAttribute('aria-hidden', 'true');
  }

  /**
   * @method setDifficultySelection
   * @description Updates the CSS 'selected' class on difficulty buttons.
   * @param index  The button index to select (0 = Easy, 1 = Medium, 2 = Hard).
   */
  private setDifficultySelection(index: number): void
  {
    this.difficultyOverlay.querySelectorAll('.btn-diff').forEach((btn, i) =>
    {
      btn.classList.toggle('selected', i === index);
    });
  }

  /**
   * @method setEndSelection
   * @description Updates the CSS 'selected' class on end-screen buttons.
   * @param index  The button index to select (0 = Rematch, 1 = Main Menu).
   */
  private setEndSelection(index: number): void
  {
    this.endOverlay.querySelectorAll('.btn-end').forEach((btn, i) =>
    {
      btn.classList.toggle('selected', i === index);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCORE POP ANIMATION
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method tickScorePops
   * @description Eases score1Pop and score2Pop back toward 1.0 each frame.
   *              Uses an exponential decay so the pop feels snappy.
   *              On goal: the scoring player's pop is set to 1.55 by updatePhysics().
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private tickScorePops(deltaMs: number): void
  {
    /* k: fraction to close the gap each frame.  At 60fps, ~10 frames to settle. */
    const k = 1 - Math.exp(-10 * deltaMs / 1000);
    this.state.score1Pop += (1 - this.state.score1Pop) * k;
    this.state.score2Pop += (1 - this.state.score2Pop) * k;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PADDLE SLIDE TO CENTER
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method slidePaddlesToCenter
   * @description Smoothly moves both paddles toward vertical center during
   *              POINT_SCORED so they are in a neutral "ready" position for
   *              the next serve.  Uses exponential ease (settles in ~0.5s).
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private slidePaddlesToCenter(deltaMs: number): void
  {
    /* k: exponential ease constant.  -6 → settles in ~0.5 seconds. */
    const k = 1 - Math.exp(-6 * deltaMs / 1000);

    for (const p of [this.state.player1, this.state.player2])
    {
      /* Use actual paddle height so GOAT / WIDE_PADDLE paddles center correctly. */
      const targetY = (CANVAS_HEIGHT - p.height) / 2;
      p.prevY  = p.y;
      p.y     += (targetY - p.y) * k;
      p.vy     = 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RALLY TIER + DRONE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method computeRallyTier
   * @description Maps a rally hit count to a 0–4 intensity tier.
   * @param count  Current consecutive hit count.
   * @returns {number} 0 = normal; 1 = building; 2 = intense; 3 = dramatic; 4 = legendary.
   */
  private computeRallyTier(count: number): number
  {
    if (count >= RALLY_TIER_LEGENDARY) return 4;
    if (count >= RALLY_TIER_DRAMATIC)  return 3;
    if (count >= RALLY_TIER_INTENSE)   return 2;
    if (count >= RALLY_TIER_BUILDING)  return 1;
    return 0;
  }

  /**
   * @method updateRallyDrone
   * @description Checks if the rally tier has changed and updates the audio drone
   *              accordingly.  Only calls setRallyDrone when the tier actually changes
   *              to avoid redundant audio graph manipulations.
   */
  private updateRallyDrone(): void
  {
    const tier = this.computeRallyTier(this.state.rallyCount);
    if (tier !== this.currentDroneTier)
    {
      this.currentDroneTier = tier;
      this.audio.setRallyDrone(tier);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PADDLE MOVEMENT (P1 only; P2 is driven by AIController)
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method updatePaddleMovement
   * @description Reads player input and updates P1's velocity and position.
   *              Uses the same acceleration/deceleration curve as the AI.
   *
   *              SPEED_BOOTS boost scales both max speed and acceleration.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private updatePaddleMovement(deltaMs: number): void
  {
    const { state, input } = this;
    const dt = deltaMs / 1000;
    const p1 = state.player1;

    p1.prevY = p1.y;

    /* SPEED_BOOTS scales both max speed and acceleration multiplier. */
    const speedBoost1 = this.hasBoost(1, 'SPEED_BOOTS');
    const p1MaxSpeed  = PADDLE_BASE_SPEED * (speedBoost1 ? POWERUP_SPEED_FACTOR      : 1);
    const p1Accel     = PADDLE_ACCEL      * (speedBoost1 ? POWERUP_SPEED_ACCEL_FACTOR : 1);

    /* Touch: move the paddle center directly to the finger.
       This feels like dragging it — no deadzone lag, instant response.
       Derive p1.vy from the position delta so spin still works correctly. */
    const fingerCSS = input.touchAbsY();
    if (fingerCSS !== null)
    {
      const gameY = (fingerCSS / window.innerHeight) * CANVAS_HEIGHT;
      const newY  = Math.max(0, Math.min(CANVAS_HEIGHT - p1.height, gameY - p1.height / 2));
      p1.vy = Math.max(-p1MaxSpeed, Math.min(p1MaxSpeed, (newY - p1.y) / Math.max(dt, 0.001)));
      p1.y  = newY;
      return;
    }

    const p1Up   = input.p1Up();
    const p1Down = input.p1Down();

    if (p1Up && !p1Down)
    {
      /* Accelerate upward (negative vy). */
      p1.vy = Math.max(p1.vy - p1Accel, -p1MaxSpeed);
    }
    else if (p1Down && !p1Up)
    {
      /* Accelerate downward (positive vy). */
      p1.vy = Math.min(p1.vy + p1Accel, p1MaxSpeed);
    }
    else
    {
      /* No input — apply the Mario-skid deceleration curve.
         speedNorm: current speed as fraction of max (0–1).
         t:         power-curve weight (spends more time near FAST end).
         Blend: high speed → more FAST decel (longer carry).             */
      const speedNorm = Math.abs(p1.vy) / p1MaxSpeed;
      const t         = Math.pow(speedNorm, PADDLE_DECEL_CURVE);
      p1.vy          *= PADDLE_DECEL_SLOW + (PADDLE_DECEL_FAST - PADDLE_DECEL_SLOW) * t;

      /* Snap to zero to prevent micro-oscillation. */
      if (Math.abs(p1.vy) < 1) p1.vy = 0;
    }

    /* Integrate velocity into position, clamp to canvas bounds. */
    p1.y += p1.vy * dt;
    p1.y  = Math.max(0, Math.min(CANVAS_HEIGHT - p1.height, p1.y));
  }

  /**
   * @method updateAnimations
   * @description Advances spring and timer animations for both paddles.
   *              Thin wrapper over updatePaddleAnimations() in physics.ts.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private updateAnimations(deltaMs: number): void
  {
    updatePaddleAnimations(this.state.player1, deltaMs);
    updatePaddleAnimations(this.state.player2, deltaMs);
    this.state.wallFlashTop    = Math.max(0, this.state.wallFlashTop    - deltaMs);
    this.state.wallFlashBottom = Math.max(0, this.state.wallFlashBottom - deltaMs);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PHYSICS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method updatePhysics
   * @description The main physics update for the PLAYING phase.
   *
   * Order:
   *   1. Sticky ball — if ball is held on a paddle, pin it and count down.
   *   2. Ball physics — update position, wall bounces, paddle collision.
   *   3. Paddle hit events — impact ring, shake, audio, rally counter.
   *   4. Power-up orb collection.
   *   5. Wall bounce audio + wall marks.
   *   6. Goal detection — score update, phase transition, fanfare.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private updatePhysics(deltaMs: number): void
  {
    const { state } = this;

    /* ── 1. Sticky ball hold ──────────────────────────────────────────────
       While stickyHoldMs > 0 the ball is pinned to the owning paddle face.
       On timer expiry the ball is released with its stored velocity.     */
    if (state.ball.stickyHoldMs > 0)
    {
      state.ball.stickyHoldMs = Math.max(0, state.ball.stickyHoldMs - deltaMs);

      const ownerPaddle = state.ball.stickyOwner === 1 ? state.player1 : state.player2;

      /* Pin ball to the appropriate face of the holding paddle. */
      if (state.ball.stickyOwner === 1)
      {
        state.ball.x = ownerPaddle.x + ownerPaddle.width + state.ball.radius;
      }
      else
      {
        state.ball.x = ownerPaddle.x - state.ball.radius;
      }

      /* Track paddle Y so ball follows vertically. */
      state.ball.y = Math.max(
        state.ball.radius,
        Math.min(CANVAS_HEIGHT - state.ball.radius, ownerPaddle.y + ownerPaddle.height / 2)
      );

      /* Release the ball when the hold timer expires. */
      if (state.ball.stickyHoldMs === 0)
      {
        const wasOwner  = state.ball.stickyOwner;
        state.ball.vx   = state.ball.stickyVx;
        state.ball.vy   = state.ball.stickyVy;
        state.ball.stickyOwner = null;

        /* Reward: boost spin on release for aiming control. */
        if (wasOwner !== null && this.hasBoost(wasOwner, 'STICKY_PADDLE'))
        {
          state.ball.spin *= 1.8;
        }
      }

      return; // skip normal physics while ball is held
    }

    /* ── 2. Ball physics ──────────────────────────────────────────────── */
    const result = updateBall(
      state.ball,
      state.player1,
      state.player2,
      deltaMs,
      false // not toy mode
    );

    /* ── 3. Paddle hit events ─────────────────────────────────────────── */
    if (result.hitPaddle !== null)
    {
      const hitPaddle = result.hitPaddle === 1 ? state.player1 : state.player2;
      const color     = result.hitPaddle === 1 ? COLOR_P1 : COLOR_P2;

      /* Track which player last hit (determines who gets orb credit). */
      state.lastHitPlayer = result.hitPaddle;

      /* Visual and audio feedback. */
      spawnImpactRing(state.impactRings, state.ball.x, state.ball.y, color);
      triggerShake(state.shake, SHAKE_HIT_INTENSITY, SHAKE_HIT_MS);

      const edgeFactor = (state.ball as Ball & { _edgeFactor?: number })._edgeFactor ?? 0;
      this.audio.playPaddleHit(state.ball.speed, edgeFactor);

      this.rallyHits++;
      state.rallyCount++;

      /* Update bass drone when rally crosses a tier boundary. */
      this.updateRallyDrone();

      /* Spin discovery: show "✧ SPIN ✧" label once after 3 hits with paddle movement. */
      if (!this.spinDiscoveryShown && this.rallyHits >= 3 && Math.abs(hitPaddle.vy) > 60)
      {
        this.spinDiscoveryShown = true;
        this.spinDiscoveryTimer = 1500;
        this.audio.playSpinDiscovery();
      }

      /* ── STICKY_PADDLE power-up: catch and hold the ball ── */
      if (this.hasBoost(result.hitPaddle, 'STICKY_PADDLE') && state.ball.stickyHoldMs === 0)
      {
        state.ball.stickyVx    = state.ball.vx;
        state.ball.stickyVy    = state.ball.vy;
        state.ball.vx          = 0;
        state.ball.vy          = 0;
        state.ball.stickyHoldMs = POWERUP_STICKY_HOLD_MS;
        state.ball.stickyOwner  = result.hitPaddle;
      }

      /* ── TRAIL_BLAZER power-up: extra speed on each hit ── */
      if (this.hasBoost(result.hitPaddle, 'TRAIL_BLAZER'))
      {
        const mag = Math.sqrt(state.ball.vx ** 2 + state.ball.vy ** 2);
        if (mag > 0)
        {
          const newMag    = Math.min(mag + POWERUP_TRAIL_SPEED_BONUS, BALL_MAX_SPEED * 1.1);
          state.ball.vx   = (state.ball.vx / mag) * newMag;
          state.ball.vy   = (state.ball.vy / mag) * newMag;
          state.ball.speed = newMag;
        }
      }

      /* ── GOAT mode: super spin + 4× speed on every P1 hit ── */
      if (this.goatMode && result.hitPaddle === 1)
      {
        /* Spin direction follows paddle movement; default to topspin if stationary. */
        const spinSign    = state.player1.vy !== 0 ? Math.sign(state.player1.vy) : 1;
        state.ball.spin   = GOAT_SPIN_AMOUNT * spinSign;

        /* Scale velocity to 4× and cap at GOAT_BALL_MAX_SPEED. */
        const mag = Math.sqrt(state.ball.vx ** 2 + state.ball.vy ** 2);
        if (mag > 0)
        {
          const newMag     = Math.min(mag * GOAT_SPEED_MULT, GOAT_BALL_MAX_SPEED);
          state.ball.vx    = (state.ball.vx / mag) * newMag;
          state.ball.vy    = (state.ball.vy / mag) * newMag;
          state.ball.speed = newMag;
        }
      }
    }

    /* ── 4. Power-up orb collection ─────────────────────────────────────
       Check if the ball overlaps any orb (circle–circle distance check). */
    for (let i = state.powerUps.length - 1; i >= 0; i--)
    {
      const pu = state.powerUps[i];
      const dx = state.ball.x - pu.x;
      const dy = state.ball.y - pu.y;

      if (dx * dx + dy * dy < (BALL_RADIUS + POWERUP_RADIUS) ** 2)
      {
        /* Grant boost to the last player who hit the ball. */
        state.activeBoosts.push(
        {
          type:      pu.type,
          owner:     state.lastHitPlayer,
          expiresAt: this.gameTime + POWERUP_BOOST_MS,
        });

        /* Visual feedback — two overlapping rings for extra emphasis. */
        const puColor = this.powerUpColor(pu.type);
        spawnImpactRing(state.impactRings, pu.x, pu.y, puColor);
        spawnImpactRing(state.impactRings, pu.x, pu.y, puColor);

        this.audio.playPowerUpCollect();
        state.powerUps.splice(i, 1);
      }
    }

    /* ── 5. Wall bounce audio, scorch marks, and wall flash ── */
    if (result.hitWall === 'top')
    {
      this.audio.playWallBounce();
      spawnWallMark(state.wallMarks, state.ball.x, 0);
      state.wallFlashTop = WALL_FLASH_MS;
    }
    else if (result.hitWall === 'bottom')
    {
      this.audio.playWallBounce();
      spawnWallMark(state.wallMarks, state.ball.x, CANVAS_HEIGHT);
      state.wallFlashBottom = WALL_FLASH_MS;
    }

    /* ── 6. Goal detection ─────────────────────────────────────────────── */
    if (result.goal !== null)
    {
      const isLegendary = state.rallyCount >= RALLY_TIER_LEGENDARY;

      /* Stop drone immediately — the silence after a goal is deliberate. */
      this.currentDroneTier = 0;
      this.audio.setRallyDrone(0);

      /* Bigger shake for legendary rally goals. */
      if (isLegendary)
      {
        triggerShake(state.shake, LEGENDARY_SHAKE_INTENSITY, LEGENDARY_SHAKE_MS);
      }
      else
      {
        triggerShake(state.shake, SHAKE_GOAL_INTENSITY, SHAKE_GOAL_MS);
      }

      this.audio.playGoal(isLegendary);

      /* Ball makes a sad face for BALL_SAD_MS after entering a goal. */
      state.ball.sadTimer = BALL_SAD_MS;

      /* ── Score update and effects by which player scored ── */
      if (result.goal === 1)
      {
        /* P1 scored — ball exited right boundary. */
        state.score1++;
        state.score1Pop = 1.55;
        triggerPaddleEmotion(state.player1, true);   // P1 paddle jumps
        triggerPaddleEmotion(state.player2, false);  // P2 paddle sags
        spawnGoalFlash(state.goalFlashes, 1);         // right half flashes
        spawnGoalParticles(state.goalParticles, CANVAS_WIDTH, state.ball.y, COLOR_P2, Math.PI);
        this.servingToward = false; // P2 conceded → serve toward P2 next
      }
      else
      {
        /* P2 scored — ball exited left boundary. */
        state.score2++;
        state.score2Pop = 1.55;
        triggerPaddleEmotion(state.player2, true);   // P2 paddle jumps
        triggerPaddleEmotion(state.player1, false);  // P1 paddle sags
        spawnGoalFlash(state.goalFlashes, 2);         // left half flashes
        spawnGoalParticles(state.goalParticles, 0, state.ball.y, COLOR_P1, 0);
        this.servingToward = true;  // P1 conceded → serve toward P1 next
      }

      /* Notify AI of the result — updates its hot/cold form factor. */
      this.ai.notifyGoal(result.goal as 1 | 2);

      /* Exhale duration scales with the rally that just ended. */
      const extraMs  = Math.min(state.rallyCount * EXHALE_PER_RALLY_HIT, EXHALE_EXTRA_CAP_MS);
      const exhaleMs = EXHALE_BASE_MS + extraMs;

      /* Update longest rally record. */
      if (state.rallyCount > state.longestRally)
      {
        state.longestRally = state.rallyCount;
      }

      /* Reset rally counters. */
      state.rallyCount = 0;
      this.rallyHits   = 0;

      /* Freeze ball at center — it will materialise during POINT_SCORED. */
      state.ball.vx          = 0;
      state.ball.vy          = 0;
      state.ball.x           = CANVAS_WIDTH  / 2;
      state.ball.y           = CANVAS_HEIGHT / 2;
      state.ball.trail       = [];
      state.ball.stickyHoldMs = 0;
      state.ball.stickyOwner  = null;
      state.materializeAlpha  = 0;

      /* ── Phase transition: match over or new point? ── */
      if (state.score1 >= MATCH_TARGET || state.score2 >= MATCH_TARGET)
      {
        state.phase = 'MATCH_END';
        this.audio.playMatchWin();
        const winner = state.score1 >= MATCH_TARGET ? 'PLAYER WINS!' : 'AI WINS!';
        this.showEndOverlay(winner, state.score1, state.score2, state.longestRally);
      }
      else
      {
        state.phase     = 'POINT_SCORED';
        this.phaseTimer = exhaleMs;
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MATCH LIFECYCLE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method startMatch
   * @description Resets all match state and begins a new game with the
   *              currently selected difficulty.
   *
   *              Called by confirmDifficulty() and resetMatch().
   *              Begins in POINT_SCORED so there's an initial "exhale" before
   *              the first serve.
   */
  private startMatch(): void
  {
    const { state } = this;

    /* Ensure both HTML overlays are hidden before gameplay starts. */
    this.hideDifficultyOverlay();
    this.hideEndOverlay();

    /* ── Reset all match state ── */
    state.score1       = 0;
    state.score2       = 0;
    state.rallyCount   = 0;
    state.longestRally = 0;
    state.impactRings  = [];
    state.wallMarks    = [];
    state.goalFlashes  = [];
    state.goalParticles = [];
    state.ball         = makeBall();
    state.player1      = makePaddle(1);
    state.player2      = makePaddle(2);
    state.shake        = makeShake();
    state.difficulty   = this.difficulty;
    state.materializeAlpha = 0;
    state.score1Pop    = 1;
    state.score2Pop    = 1;
    state.powerUps     = [];
    state.activeBoosts = [];
    state.lastHitPlayer = 1;

    /* ── Reset private match-tracking fields ── */
    this.rallyHits     = 0;
    this.currentDroneTier = 0;
    this.servingToward = true;
    this.gameTime      = 0;
    this.powerUpTimer  = 0;
    this.powerUpIdCtr  = 0;

    /* Randomize the first orb spawn window. */
    this.powerUpInterval = POWERUP_SPAWN_MIN_MS +
      Math.random() * (POWERUP_SPAWN_MAX_MS - POWERUP_SPAWN_MIN_MS);

    this.audio.setRallyDrone(0);
    this.pauseBtn.classList.remove('hidden');

    /* Start in POINT_SCORED for a brief pause before the first serve. */
    state.phase     = 'POINT_SCORED';
    this.phaseTimer = EXHALE_BASE_MS;
  }

  /**
   * @method resetMatch
   * @description Rematch with the same difficulty.
   *              Resets AI state (clears stale target) then calls startMatch().
   */
  private resetMatch(): void
  {
    /* configure() resets form to 0 so a rematch starts with a neutral AI streak,
       not one carried over from the last match.  It also calls reset() internally. */
    this.ai.configure(this.difficulty);
    this.startMatch();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     POWER-UP HELPERS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method hasBoost
   * @description Checks whether a player currently has an active boost of a given type.
   *              In God Mode, P1 always has every boost.
   *
   * @param player  1 = P1 (human), 2 = P2 (AI).
   * @param type    Which power-up type to check.
   * @returns {boolean} true if the boost is active.
   */
  private hasBoost(player: 1 | 2, type: PowerUpType): boolean
  {
    /* God Mode grants all boosts to P1 unconditionally. */
    if (this.godMode && player === 1) return true;

    return this.state.activeBoosts.some(
      b => b.owner === player && b.type === type && b.expiresAt > this.gameTime
    );
  }

  /**
   * @method powerUpColor
   * @description Maps a PowerUpType to its CSS color string.
   *              Duplicated from Renderer so Game doesn't need to import from renderer.
   *
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
   * @method tickPowerUps
   * @description Advances all power-up orb and active boost timers.
   *              Spawns a new orb when the spawn timer expires and the court is clear.
   *
   *              Only one orb can be on the court at a time to prevent clutter.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private tickPowerUps(deltaMs: number): void
  {
    const { state } = this;

    /* ── Age and rotate all orbs ── */
    for (const pu of state.powerUps)
    {
      pu.age      += deltaMs;
      pu.spinAngle += 0.03; // slow clockwise rotation
    }

    /* Remove orbs that have exceeded their lifetime. */
    state.powerUps = state.powerUps.filter(pu => pu.age < POWERUP_LIFETIME_MS);

    /* Remove boosts that have expired. */
    state.activeBoosts = state.activeBoosts.filter(b => b.expiresAt > this.gameTime);

    /* ── Spawn new orb ─────────────────────────────────────────────────
       Wait at least POWERUP_SPAWN_MIN_MS between orbs.  Only one at a time. */
    this.powerUpTimer += deltaMs;
    if (this.powerUpTimer >= this.powerUpInterval && state.powerUps.length === 0)
    {
      const types: PowerUpType[] = ['WIDE_PADDLE', 'SPEED_BOOTS', 'STICKY_PADDLE', 'TRAIL_BLAZER'];
      const type  = types[Math.floor(Math.random() * types.length)];

      /* Spawn in the center zone (away from paddle areas and walls). */
      const x = POWERUP_SPAWN_MIN_X + Math.random() * (POWERUP_SPAWN_MAX_X - POWERUP_SPAWN_MIN_X);
      const y = POWERUP_SPAWN_MIN_Y + Math.random() * (POWERUP_SPAWN_MAX_Y - POWERUP_SPAWN_MIN_Y);

      state.powerUps.push(
      {
        id:         ++this.powerUpIdCtr,
        type,
        x, y,
        age:        0,
        spinAngle:  0,
      });

      /* Reset spawn timer and randomize next interval. */
      this.powerUpTimer    = 0;
      this.powerUpInterval = POWERUP_SPAWN_MIN_MS +
        Math.random() * (POWERUP_SPAWN_MAX_MS - POWERUP_SPAWN_MIN_MS);
    }
  }

  /**
   * @method applyPaddleBoosts
   * @description Applies WIDE_PADDLE height animation and SPEED_BOOTS speed cap
   *              each frame while the respective boosts are active.
   *
   *              WIDE_PADDLE uses exponential lerp for a smooth grow/shrink effect.
   *              SPEED_BOOTS caps AI velocity since AIController sets its own vy.
   *
   * @param deltaMs  Milliseconds elapsed.
   */
  private applyPaddleBoosts(deltaMs: number): void
  {
    const { state } = this;

    /* Exponential lerp constant — settles in ~0.2 seconds at 60fps. */
    const k = 1 - Math.exp(-14 * deltaMs / 1000);

    /* P1 GOAT mode overrides height to half the screen (takes priority over WIDE). */
    const target1 = this.goatMode
      ? GOAT_PADDLE_HEIGHT
      : this.hasBoost(1, 'WIDE_PADDLE')
        ? PADDLE_HEIGHT * POWERUP_WIDE_FACTOR
        : PADDLE_HEIGHT;
    state.player1.height += (target1 - state.player1.height) * k;

    /* P2 WIDE_PADDLE. */
    const target2 = this.hasBoost(2, 'WIDE_PADDLE')
      ? PADDLE_HEIGHT * POWERUP_WIDE_FACTOR
      : PADDLE_HEIGHT;
    state.player2.height += (target2 - state.player2.height) * k;

    /* P2 SPEED_BOOTS: clamp AI velocity to boosted cap.
       (P1 is handled in updatePaddleMovement() where p1MaxSpeed is recomputed.) */
    if (this.hasBoost(2, 'SPEED_BOOTS'))
    {
      const maxSpeed = PADDLE_BASE_SPEED * POWERUP_SPEED_FACTOR;
      state.player2.vy = Math.max(-maxSpeed, Math.min(maxSpeed, state.player2.vy));
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @method render
   * @description Draws the current frame.
   *
   *              DIFFICULTY_SELECT: skip canvas draw — HTML overlay is covering it.
   *              MATCH_END:         draw frozen state (no shake) — end overlay sits on top.
   *              All other phases:  full game draw with shake.
   *
   *              Countdown and spin-discovery labels are drawn on top of the game scene.
   */
  private render(): void
  {
    const { state } = this;

    /* Nothing to draw while the difficulty overlay is fully covering the canvas. */
    if (state.phase === 'DIFFICULTY_SELECT') return;

    /* In MATCH_END, freeze the camera (no shake) so the end overlay is readable. */
    const [shakeX, shakeY] = state.phase === 'MATCH_END'
      ? [0, 0]
      : getShakeOffset(state.shake);

    this.renderer.draw(state, shakeX, shakeY, this.gameTime, this.godMode, this.goatMode);

    /* ── Serve countdown overlay ── */
    if (state.phase === 'SERVING')
    {
      this.renderer.drawCountdown(String(this.countdownStep), state.ball);
    }

    /* ── Spin discovery label ── */
    if (this.spinDiscoveryTimer > 0)
    {
      this.renderer.drawSpinDiscovery(
        state.ball.x,
        state.ball.y,
        Math.min(1, this.spinDiscoveryTimer / 400) // fade in over 400ms
      );
    }
  }
}
