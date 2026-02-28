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

  /* ── Ability bindings (reserved for future phases) ───────────────────────
     These are single-fire (wasPressed) so abilities activate once per tap,
     not continuously while held.                                            */

  /** @method p1Turbo  @description P1 turbo-shot key (E). @returns {boolean} */
  p1Turbo(): boolean { return this.wasPressed('e') || this.wasPressed('E'); }

  /** @method p1Slow   @description P1 slow-field key (Q). @returns {boolean} */
  p1Slow():  boolean { return this.wasPressed('q') || this.wasPressed('Q'); }

  /** @method p1Curve  @description P1 curve-shot key (R). @returns {boolean} */
  p1Curve(): boolean { return this.wasPressed('r') || this.wasPressed('R'); }

  /** @method p1Shield @description P1 shield key (F). @returns {boolean} */
  p1Shield(): boolean { return this.wasPressed('f') || this.wasPressed('F'); }

  /** @method p2Turbo  @description P2 turbo-shot key (L). @returns {boolean} */
  p2Turbo(): boolean { return this.wasPressed('l') || this.wasPressed('L'); }

  /** @method p2Slow   @description P2 slow-field key (K). @returns {boolean} */
  p2Slow():  boolean { return this.wasPressed('k') || this.wasPressed('K'); }

  /** @method p2Curve  @description P2 curve-shot key (;). @returns {boolean} */
  p2Curve(): boolean { return this.wasPressed(';'); }

  /** @method p2Shield @description P2 shield key ('). @returns {boolean} */
  p2Shield(): boolean { return this.wasPressed("'"); }

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
  confirm(): boolean { return this.wasPressed('Enter') || this.wasPressed(' '); }

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
