/**
 * @file audio.ts
 * @description AudioManager — all game sounds synthesized live via the Web Audio API.
 *
 * NO AUDIO FILES ARE USED.  Every sound is created programmatically by connecting
 * oscillators and noise buffers together, then routing them through a master gain
 * node so volume and mute are controlled from one place.
 *
 * WEB AUDIO 101 (for new readers)
 * --------------------------------
 * The Web Audio API models sound processing as a graph of nodes:
 *
 *   Source nodes (OscillatorNode, AudioBufferSourceNode) → Processing nodes → Destination
 *
 * Every time a sound plays we create a fresh OscillatorNode, ramp its gain to
 * zero over the desired duration, and let it auto-stop.  We never reuse these
 * short-lived nodes — it is cheaper to throw them away and create new ones.
 *
 * The one exception is the rally drone, which is a *persistent* oscillator that
 * fades in and out so there are no clicks on tier changes.
 *
 * CRITICAL WEB AUDIO GOTCHA — setValueAtTime vs .value
 * ------------------------------------------------------
 * To set a gain before scheduling a ramp, you MUST use:
 *
 *   gain.gain.value = v;                               ← CORRECT
 *
 * NOT:
 *
 *   gain.gain.setValueAtTime(v, ctx.currentTime);      ← BROKEN
 *
 * `setValueAtTime` enters the *automation timeline*.  If the audio rendering
 * quantum (≈ 128 samples ≈ 2.7ms) has already ticked past `currentTime` when
 * your JavaScript runs, the scheduled value is silently discarded and the
 * subsequent `exponentialRampToValueAtTime` collapses to silence.
 *
 * Using `.value` sets the *intrinsic value* that ramp functions correctly read
 * as their start point, regardless of rendering quantum timing.
 *
 * AUTOPLAY POLICY
 * ---------------
 * Browsers suspend the AudioContext immediately after creation to prevent
 * unwanted audio.  We call `ctx.resume()` in `getCtx()` every time a sound
 * is about to play, which is safe because browsers allow resume() after a
 * user gesture (key press, click, etc.).
 */

/**
 * @class AudioManager
 * @description Centralized audio system.  One instance lives in Game for the
 *              lifetime of the match.
 *
 * Public interface:
 *   - toggleMute() / isMuted      — master mute
 *   - tick(deltaMs)               — must be called every frame to advance timers
 *   - playPaddleHit(speed, edge)  — hit sound, pitch-matched to ball speed
 *   - playWallBounce()            — lighter wall-bounce sound
 *   - playGoal(legendary?)        — dramatic goal fanfare
 *   - setRallyDrone(tier)         — background drone (0 = off, 1–4 = escalating)
 *   - playCountdownBeep(index)    — 3-2-1 serve countdown beeps
 *   - play*() — one-shot sounds for match win, power-ups, menus, etc.
 */
export class AudioManager
{
  /* ── Audio graph ────────────────────────────────────────────────────────
     ctx         — the Web Audio context; null until first sound is played
     masterGain  — everything routes here; controls master volume and mute  */

  private ctx: AudioContext | null = null;
  private muted = false;
  private masterGain!: GainNode;

  /* ── Post-goal silence timer ────────────────────────────────────────────
     After a goal the normal game sounds (paddle hits, wall bounces) are
     silenced for a short period so the goal fanfare isn't stepped on.
     Measured in ms; counts down to zero each frame via tick().            */
  private postGoalSilence = 0;

  /* ── Rally drone ────────────────────────────────────────────────────────
     A persistent low-frequency oscillator that fades in as rally intensity
     builds.  Using a *persistent* oscillator (rather than spawning new ones)
     avoids the click artifact that would occur if we abruptly started/stopped
     on every tier change.                                                  */
  private droneOsc:  OscillatorNode | null = null;
  private droneGain: GainNode       | null = null;

  /* ── Private helpers ──────────────────────────────────────────────────── */

  /**
   * @method getCtx
   * @description Lazy-initializes the AudioContext on first use and resumes
   *              it if the browser has suspended it (autoplay policy).
   *
   *              We create the context lazily (not in the constructor) because
   *              some browsers block AudioContext creation before a user gesture.
   *
   * @returns {AudioContext} The live, resumed audio context.
   */
  private getCtx(): AudioContext
  {
    if (!this.ctx)
    {
      /* First sound ever — create the context and master gain node. */
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;                 // 60% master volume
      this.masterGain.connect(this.ctx.destination);    // route to speakers
    }

    /* Resume if the browser suspended the context (autoplay policy).
       This is safe to call even when already running — it's a no-op.    */
    if (this.ctx.state === 'suspended')
    {
      this.ctx.resume();
    }

    return this.ctx;
  }

  /**
   * @method osc
   * @description Spawn a single-shot oscillator that decays to silence.
   *              The node is created, connected, played, and then auto-garbage-
   *              collected — nothing to clean up manually.
   *
   * @param type      Waveform: 'sine' | 'square' | 'sawtooth' | 'triangle'
   * @param freq      Starting frequency (Hz)
   * @param gainVal   Initial gain (0–1)
   * @param duration  How long the sound lasts (seconds)
   * @param freqEnd   Optional: frequency to ramp to by the end (Hz)
   */
  private osc(
    type: OscillatorType,
    freq: number,
    gainVal: number,
    duration: number,
    freqEnd?: number
  ): void
  {
    if (this.muted) return;
    const ctx = this.getCtx();

    /* Create the oscillator and gain envelope. */
    const oscillator = ctx.createOscillator();
    const gain       = ctx.createGain();

    oscillator.type            = type;
    oscillator.frequency.value = freq;

    /* Optional frequency sweep (e.g., descending pitch on goal). */
    if (freqEnd !== undefined)
    {
      oscillator.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + duration);
    }

    /* Set gain using .value (NOT setValueAtTime — see file header for why). */
    gain.gain.value = gainVal;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    /* Wire up and start. */
    oscillator.connect(gain);
    gain.connect(this.masterGain);

    /* osc.start() with no argument starts immediately.
       Never use osc.start(ctx.currentTime) — same rendering-quantum race as
       setValueAtTime causes silent output if the quantum ticked first.     */
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration + 0.01); // tiny buffer avoids clip
  }

  /* ── Public volume control ────────────────────────────────────────────── */

  /**
   * @method toggleMute
   * @description Flips the muted state.  When muted, masterGain is set to 0
   *              so all existing and future sounds are silenced.
   */
  toggleMute(): void
  {
    this.muted = !this.muted;
    if (this.ctx)
    {
      this.masterGain.gain.value = this.muted ? 0 : 0.6;
    }
  }

  /**
   * @method isMuted
   * @description Returns the current mute state.
   */
  get isMuted(): boolean { return this.muted; }

  /* ── Frame tick ──────────────────────────────────────────────────────── */

  /**
   * @method tick
   * @description Advances the post-goal silence timer by one frame.
   *              Must be called once per game frame during PLAYING phase.
   *
   * @param deltaMs  Elapsed time since last frame (ms).
   */
  tick(deltaMs: number): void
  {
    if (this.postGoalSilence > 0)
    {
      this.postGoalSilence = Math.max(0, this.postGoalSilence - deltaMs);
    }
  }

  /* ── Game sound effects ───────────────────────────────────────────────── */

  /**
   * @method playPaddleHit
   * @description Plays a "bwip" paddle-hit sound.
   *
   *              Pitch maps to ball speed so fast rallies sound increasingly
   *              urgent (330 Hz slow → 660 Hz fast, an octave range).
   *              Edge hits use a triangle wave + detune for a softer, off-center feel.
   *
   * @param speed       Ball speed at the moment of contact (px/s)
   * @param edgeFactor  0 = dead center hit, 1 = extreme edge hit
   */
  playPaddleHit(speed: number, edgeFactor = 0): void
  {
    if (this.muted || this.postGoalSilence > 0) return;
    const actx = this.getCtx();

    /* Map speed → frequency: 330 Hz at 300 px/s, 660 Hz at 720 px/s. */
    const t    = Math.min(Math.max((speed - 300) / 420, 0), 1);
    const freq = 330 + t * 330;
    const isEdge = edgeFactor > 0.5;

    const oscillator = actx.createOscillator();
    const gain       = actx.createGain();

    /* Triangle wave + detuning for edge hits = softer, more imprecise feel. */
    oscillator.type            = isEdge ? 'triangle' : 'sine';
    oscillator.frequency.value = freq;
    oscillator.frequency.linearRampToValueAtTime(freq + 100, actx.currentTime + 0.03);
    if (isEdge) oscillator.detune.value = 30;

    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.08);

    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start();
    oscillator.stop(actx.currentTime + 0.09);
  }

  /**
   * @method playWallBounce
   * @description Lighter, softer sound for top/bottom wall bounces.
   *              Intentionally quieter than paddle hits so it doesn't compete.
   */
  playWallBounce(): void
  {
    if (this.postGoalSilence > 0) return;
    this.osc('square', 200, 0.12, 0.045);
  }

  /**
   * @method playGoal
   * @description Dramatic goal fanfare: a low "boom" layered with a descending
   *              frequency sweep.  Followed by a period of silence (postGoalSilence)
   *              so that the contrast between the boom and quiet IS the drama.
   *
   *              Legendary goals (20+ hit rally) get a louder, longer version
   *              plus a longer silence afterward.
   *
   * @param isLegendary  true when the rally that just ended had 20+ hits
   */
  playGoal(isLegendary = false): void
  {
    if (this.muted) return;
    const actx = this.getCtx();

    /* ── Impact boom ──────────────────────────────────────────────────────
       Low 80 Hz sine wave, rapid exponential decay.                       */
    const boom     = actx.createOscillator();
    const boomGain = actx.createGain();
    boom.type            = 'sine';
    boom.frequency.value = 80;
    boomGain.gain.value  = isLegendary ? 0.55 : 0.4;
    boomGain.gain.exponentialRampToValueAtTime(
      0.0001,
      actx.currentTime + (isLegendary ? 0.45 : 0.3)
    );
    boom.connect(boomGain);
    boomGain.connect(this.masterGain);
    boom.start();
    boom.stop(actx.currentTime + 0.5);

    /* ── Descending sweep ─────────────────────────────────────────────────
       500 Hz (or 650 Hz legendary) drops to 100 Hz over 400ms — the
       classic "falling" sound effect.                                      */
    const sweep     = actx.createOscillator();
    const sweepGain = actx.createGain();
    sweep.type            = 'sine';
    sweep.frequency.value = isLegendary ? 650 : 500;
    sweep.frequency.linearRampToValueAtTime(100, actx.currentTime + 0.4);
    sweepGain.gain.value  = 0.2;
    sweepGain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.4);
    sweep.connect(sweepGain);
    sweepGain.connect(this.masterGain);
    sweep.start();
    sweep.stop(actx.currentTime + 0.41);

    /* ── Post-goal silence ────────────────────────────────────────────────
       All non-goal sounds (paddle hits, wall bounces) are blocked during
       this window.  The silence IS the payoff — it makes the goal feel
       weighty and lets the player absorb what just happened.              */
    this.postGoalSilence = isLegendary ? 900 : 500;

    /* ── Exhale sigh ──────────────────────────────────────────────────────
       A quiet descending tone 380ms after impact — like a collective exhale.
       Uses osc() directly, bypassing postGoalSilence (this IS the silence). */
    setTimeout(() =>
    {
      if (!this.muted && this.ctx)
      {
        this.osc('sine', 160, 0.04, 0.5, 80); // quiet sigh: 160 Hz → 80 Hz
      }
    }, 380);
  }

  /**
   * @method setRallyDrone
   * @description Controls the persistent background drone that builds tension
   *              during long rallies.
   *
   *              tier 0 = silent
   *              tier 1 = subtle bass murmur (rally building)
   *              tier 2 = audible low tone (intense)
   *              tier 3 = deeper, louder pulse (dramatic)
   *              tier 4 = maximum bass rumble (legendary)
   *
   *              The drone uses `setTargetAtTime` for smooth gain transitions
   *              (no sudden clicks when tiers change mid-rally).
   *
   * @param tier  0–4 intensity level
   */
  setRallyDrone(tier: number): void
  {
    if (this.muted && tier > 0) return;

    /* Lazy-initialize the persistent oscillator on first use. */
    if (!this.droneOsc && tier > 0)
    {
      const actx    = this.getCtx();
      this.droneOsc  = actx.createOscillator();
      this.droneGain = actx.createGain();
      this.droneOsc.type            = 'sine';
      this.droneOsc.frequency.value = 65;     // starts at 65 Hz, drifts lower with tier
      this.droneGain.gain.value     = 0;      // silent until ramped up
      this.droneOsc.connect(this.droneGain);
      this.droneGain.connect(this.masterGain);
      this.droneOsc.start();
    }

    if (!this.droneGain || !this.ctx) return;
    const now = this.ctx.currentTime;

    /* Target gain and pitch levels per tier.
       Both gain and frequency drop as tier increases — deeper is scarier. */
    const gains = [0,     0.032, 0.060, 0.090, 0.140];
    const freqs = [65,    62,    58,    54,    50   ];

    /* setTargetAtTime smoothly approaches the target over a time constant.
       Tier 0 (fade-out) uses a faster constant so silence comes quickly.  */
    this.droneGain.gain.setTargetAtTime(
      gains[Math.min(tier, 4)],
      now,
      tier === 0 ? 0.3 : 0.8
    );
    this.droneOsc!.frequency.setTargetAtTime(
      freqs[Math.min(tier, 4)],
      now,
      1.0
    );
  }

  /**
   * @method playCountdownBeep
   * @description Plays one beep of the serve countdown (3… 2… 1… GO!).
   *              The final beep (index 2 = "GO!") is higher and louder.
   *
   * @param beepIndex  0 = "3", 1 = "2", 2 = "GO!" (highest pitch)
   */
  playCountdownBeep(beepIndex: number): void
  {
    const freq = beepIndex === 2 ? 1100 : 720;
    const vol  = beepIndex === 2 ? 0.28 : 0.18;
    this.osc('sine', freq, vol, beepIndex === 2 ? 0.22 : 0.08);
  }

  /**
   * @method playMatchWin
   * @description Ascending C-E-G-C arpeggio for match win.
   */
  playMatchWin(): void
  {
    const notes = [262, 330, 392, 523]; // C4, E4, G4, C5
    notes.forEach((hz, i) =>
    {
      setTimeout(() => this.osc('sine', hz, 0.3, 0.18), i * 110);
    });
  }

  /**
   * @method playMenuNav
   * @description Quiet click for menu navigation.
   */
  playMenuNav(): void
  {
    this.osc('sine', 280, 0.1, 0.04);
  }

  /**
   * @method playMenuConfirm
   * @description Slightly louder tone for menu selection confirmation.
   */
  playMenuConfirm(): void
  {
    this.osc('sine', 480, 0.15, 0.07);
  }

  /**
   * @method playPowerUpCollect
   * @description Bright two-tone chime when a power-up orb is collected.
   */
  playPowerUpCollect(): void
  {
    this.osc('sine', 660, 0.18, 0.08);
    setTimeout(() => this.osc('sine', 990, 0.22, 0.12), 55);
  }

  /**
   * @method playSpinDiscovery
   * @description Four-note shimmer played the first time a player discovers
   *              the spin mechanic (used for the tutorial "Spin!" hint).
   */
  playSpinDiscovery(): void
  {
    [800, 1000, 1200, 1000].forEach((hz, i) =>
    {
      setTimeout(() => this.osc('sine', hz, 0.08, 0.1), i * 60);
    });
  }
}
