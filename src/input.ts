/**
 * @file input.ts
 * @description Keyboard input manager for Neon Pong.
 *
 * Browsers fire `keydown` repeatedly while a key is held (key-repeat), which
 * makes it tricky to detect "just pressed this frame" vs "held for many frames".
 * InputManager solves this with three independent Sets:
 *
 *   held         — keys currently held down (updated on keydown / keyup)
 *   justPressed  — keys that went down *this frame* (cleared by flush())
 *   justReleased — keys that came up  *this frame* (cleared by flush())
 *
 * Call flush() exactly once per frame, AFTER you have finished reading input,
 * so that single-fire events (wasPressed / wasReleased) last exactly one frame.
 */

/**
 * @class InputManager
 * @description Centralized keyboard-state tracker.
 *
 * Usage pattern each frame:
 *   1. Read isDown() / wasPressed() / wasReleased() as needed.
 *   2. Call flush() to clear the single-frame sets.
 *
 * The class attaches global `keydown` and `keyup` listeners in its constructor
 * and never removes them — one instance lives for the lifetime of the page.
 */
export class InputManager
{
  /* ── Private state ────────────────────────────────────────────────────────
     All three sets hold browser key names exactly as reported by KeyboardEvent.key
     (e.g. 'w', 'W', 'ArrowUp', 'Escape', ' '). Case matters: 'w' ≠ 'W'.   */

  /** Keys currently held down. Persists until the physical key is released. */
  private held         = new Set<string>();

  /** Keys that transitioned down THIS frame. Cleared by flush(). */
  private justPressed  = new Set<string>();

  /** Keys that transitioned up THIS frame. Cleared by flush(). */
  private justReleased = new Set<string>();

  /* ── Touch state ──────────────────────────────────────────────────────────
     Tracks a single finger for paddle control (continuous drag) and taps
     (single-fire confirm).  All values are in CSS pixels.                   */

  /** clientY where the finger first touched down; null when no touch active. */
  private touchY0: number | null = null;

  /** clientX where the finger first touched down; used for tap detection. */
  private touchX0: number | null = null;

  /** Current clientY of the tracked finger. */
  private touchY: number | null = null;

  /** True on the frame a tap (small-movement touchend) is detected. Cleared by flush(). */
  private touchTapped = false;

  /** Drag must exceed this (px) before the paddle registers a direction. */
  private readonly TOUCH_DEADZONE = 8;

  /* ── Constructor ─────────────────────────────────────────────────────────
     Register global listeners immediately so no input is missed.            */

  /**
   * @constructor
   * @description Registers `keydown` and `keyup` listeners on the window.
   *              Also prevents default scrolling for arrow keys and Space
   *              so the game never causes the page to jump.
   */
  constructor()
  {
    /* keydown fires once on initial press and then repeats if held.
       We use the held Set to detect "initial press" vs "repeat".           */
    window.addEventListener('keydown', (e) =>
    {
      /* Only add to justPressed on the *first* keydown, not on key-repeat.
         The held Set already contains the key if this is a repeat event.   */
      if (!this.held.has(e.key))
      {
        this.justPressed.add(e.key);
      }
      this.held.add(e.key);

      /* Prevent arrow keys and Space from scrolling the page.
         Without this the browser would scroll down when the player
         presses ArrowDown, which is jarring mid-game.                      */
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key))
      {
        e.preventDefault();
      }
    });

    /* keyup fires once when the physical key is released. */
    window.addEventListener('keyup', (e) =>
    {
      this.held.delete(e.key);
      this.justReleased.add(e.key);
    });
  }

  /**
   * @method attachTouch
   * @description Wires touch events on the given element for mobile paddle control.
   *              Call once from Game, passing the canvas element.
   *
   *              - touchstart / touchmove  → update drag delta for p1Up / p1Down
   *              - touchend (small motion) → set touchTapped flag for confirm()
   *
   * @param el  Element to attach listeners to (the game canvas).
   */
  attachTouch(el: HTMLElement): void
  {
    el.addEventListener('touchstart', (e) =>
    {
      e.preventDefault();
      const t      = e.touches[0];
      this.touchY0 = t.clientY;
      this.touchY  = t.clientY;
      this.touchX0 = t.clientX;
    }, { passive: false });

    el.addEventListener('touchmove', (e) =>
    {
      e.preventDefault();
      this.touchY = e.touches[0].clientY;
    }, { passive: false });

    el.addEventListener('touchend', (e) =>
    {
      if (this.touchY0 !== null && this.touchX0 !== null)
      {
        const dy = Math.abs((this.touchY ?? this.touchY0) - this.touchY0);
        const dx = Math.abs((e.changedTouches[0]?.clientX ?? this.touchX0) - this.touchX0);
        if (dy < 20 && dx < 20) this.touchTapped = true;
      }
      this.touchY0 = null;
      this.touchX0 = null;
      this.touchY  = null;
    }, { passive: false });
  }

  /* ── Core query methods ───────────────────────────────────────────────────
     These are the primitive building blocks that all higher-level helpers
     call into.                                                              */

  /**
   * @method isDown
   * @description Returns true for every frame the key is physically held down.
   * @param key  The browser key name (e.g. 'w', 'ArrowUp', 'Escape').
   * @returns {boolean} true while the key is held.
   */
  isDown(key: string): boolean
  {
    return this.held.has(key);
  }

  /**
   * @method wasPressed
   * @description Returns true on the *single frame* the key transitioned from
   *              up to down.  Subsequent held frames return false.
   *              Resets to false when flush() is called at the end of the frame.
   * @param key  The browser key name.
   * @returns {boolean} true only on the first frame of a press.
   */
  wasPressed(key: string): boolean
  {
    return this.justPressed.has(key);
  }

  /**
   * @method wasReleased
   * @description Returns true on the *single frame* the key was released.
   *              Resets to false when flush() is called at the end of the frame.
   * @param key  The browser key name.
   * @returns {boolean} true only on the frame the key comes up.
   */
  wasReleased(key: string): boolean
  {
    return this.justReleased.has(key);
  }

  /**
   * @method flush
   * @description Clears the single-frame sets (justPressed and justReleased).
   *
   *              Must be called exactly ONCE per game frame, AFTER all input
   *              has been checked.  If you call it too early, wasPressed() will
   *              return false for the rest of the frame even though a key was
   *              just pressed.  If you never call it, wasPressed() stays true
   *              forever (simulating key-repeat, which is wrong).
   */
  flush(): void
  {
    this.justPressed.clear();
    this.justReleased.clear();
    this.touchTapped = false;
  }

  /**
   * @method touchAbsY
   * @description Returns the current touch Y position in CSS pixels,
   *              or null when no finger is on screen.
   *              Used by Game to map the finger directly to paddle position.
   */
  touchAbsY(): number | null
  {
    return this.touchY;
  }

  /* ── Player 1 movement ────────────────────────────────────────────────────
     P1 (left paddle) uses W/S or ArrowUp/ArrowDown.                         */

  /**
   * @method p1Up
   * @description True while Player 1's "move up" keys are held.
   *              Accepts W, w, or ArrowUp.
   * @returns {boolean}
   */
  p1Up(): boolean
  {
    if (this.touchY0 !== null && this.touchY !== null &&
        this.touchY - this.touchY0 < -this.TOUCH_DEADZONE) return true;
    return this.isDown('w') || this.isDown('W') || this.isDown('ArrowUp');
  }

  /**
   * @method p1Down
   * @description True while Player 1's "move down" keys are held.
   *              Accepts S, s, or ArrowDown.
   * @returns {boolean}
   */
  p1Down(): boolean
  {
    if (this.touchY0 !== null && this.touchY !== null &&
        this.touchY - this.touchY0 > this.TOUCH_DEADZONE) return true;
    return this.isDown('s') || this.isDown('S') || this.isDown('ArrowDown');
  }

  /* ── Player 2 movement (PvP mode placeholders) ────────────────────────────
     P2 uses the arrow keys when a second human is playing.
     In PvAI mode these methods are never called — AIController drives P2.   */

  /**
   * @method p2Up
   * @description True while Player 2's "move up" key (ArrowUp) is held.
   * @returns {boolean}
   */
  p2Up(): boolean
  {
    return this.isDown('ArrowUp');
  }

  /**
   * @method p2Down
   * @description True while Player 2's "move down" key (ArrowDown) is held.
   * @returns {boolean}
   */
  p2Down(): boolean
  {
    return this.isDown('ArrowDown');
  }

  /* ── System / menu keys ──────────────────────────────────────────────────
     Single-fire so Escape doesn't toggle pause 60 times per second.        */

  /**
   * @method pause
   * @description Single-fire: true on the frame Escape is pressed.
   * @returns {boolean}
   */
  pause(): boolean { return this.wasPressed('Escape'); }

  /**
   * @method confirm
   * @description Single-fire: true on the frame Enter or Space is pressed.
   *              Used on the serve screen and in menus.
   * @returns {boolean}
   */
  confirm(): boolean { return this.wasPressed('Enter') || this.wasPressed(' ') || this.touchTapped; }

  /**
   * @method menuUp
   * @description Single-fire: true on the frame a "navigate up" key is pressed.
   *              Accepts ArrowUp, W, or w.
   * @returns {boolean}
   */
  menuUp():   boolean
  {
    return this.wasPressed('ArrowUp') || this.wasPressed('w') || this.wasPressed('W');
  }

  /**
   * @method menuDown
   * @description Single-fire: true on the frame a "navigate down" key is pressed.
   *              Accepts ArrowDown, S, or s.
   * @returns {boolean}
   */
  menuDown(): boolean
  {
    return this.wasPressed('ArrowDown') || this.wasPressed('s') || this.wasPressed('S');
  }
}
