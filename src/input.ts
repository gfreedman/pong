// InputManager — tracks keyboard state with single-fire detection

export class InputManager {
  private held = new Set<string>();
  private justPressed = new Set<string>();
  private justReleased = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.held.has(e.key)) {
        this.justPressed.add(e.key);
      }
      this.held.add(e.key);
      // Prevent arrow key page scroll
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.held.delete(e.key);
      this.justReleased.add(e.key);
    });
  }

  /** True while key is held down */
  isDown(key: string): boolean {
    return this.held.has(key);
  }

  /** True only on the first frame the key was pressed */
  wasPressed(key: string): boolean {
    return this.justPressed.has(key);
  }

  /** True only on the first frame the key was released */
  wasReleased(key: string): boolean {
    return this.justReleased.has(key);
  }

  /** Call once per frame AFTER all input checks */
  flush(): void {
    this.justPressed.clear();
    this.justReleased.clear();
  }

  // ── Convenience helpers ──────────────────────────────────────────────────

  /** Player 1 moves up (W or ArrowUp) */
  p1Up(): boolean {
    return this.isDown('w') || this.isDown('W') || this.isDown('ArrowUp');
  }

  /** Player 1 moves down (S or ArrowDown) */
  p1Down(): boolean {
    return this.isDown('s') || this.isDown('S') || this.isDown('ArrowDown');
  }

  /** Player 2 moves up (ArrowUp in PvP mode) */
  p2Up(): boolean {
    return this.isDown('ArrowUp');
  }

  /** Player 2 moves down (ArrowDown in PvP mode) */
  p2Down(): boolean {
    return this.isDown('ArrowDown');
  }

  p1Turbo(): boolean { return this.wasPressed('e') || this.wasPressed('E'); }
  p1Slow():  boolean { return this.wasPressed('q') || this.wasPressed('Q'); }
  p1Curve(): boolean { return this.wasPressed('r') || this.wasPressed('R'); }
  p1Shield():boolean { return this.wasPressed('f') || this.wasPressed('F'); }

  p2Turbo(): boolean { return this.wasPressed('l') || this.wasPressed('L'); }
  p2Slow():  boolean { return this.wasPressed('k') || this.wasPressed('K'); }
  p2Curve(): boolean { return this.wasPressed(';'); }
  p2Shield():boolean { return this.wasPressed("'"); }

  pause(): boolean { return this.wasPressed('Escape'); }
  confirm(): boolean { return this.wasPressed('Enter') || this.wasPressed(' '); }
  menuUp():   boolean { return this.wasPressed('ArrowUp') || this.wasPressed('w') || this.wasPressed('W'); }
  menuDown(): boolean { return this.wasPressed('ArrowDown') || this.wasPressed('s') || this.wasPressed('S'); }
}
