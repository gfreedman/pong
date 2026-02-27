// AudioManager — all sounds synthesized via Web Audio API, no audio files

export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;
  private masterGain!: GainNode;
  private postGoalSilence = 0; // ms remaining: block non-goal sounds after goal

  // Rally drone — persistent oscillator that fades in with rally intensity
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) {
      this.masterGain.gain.value = this.muted ? 0 : 0.6;
    }
  }

  get isMuted(): boolean { return this.muted; }

  /** Advance post-goal silence timer. Call once per frame. */
  tick(deltaMs: number): void {
    if (this.postGoalSilence > 0) {
      this.postGoalSilence = Math.max(0, this.postGoalSilence - deltaMs);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private osc(
    type: OscillatorType,
    freq: number,
    gainVal: number,
    duration: number,
    freqEnd?: number
  ): void {
    if (this.muted) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(freqEnd, now + duration);
    }

    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  private noise(gainVal: number, duration: number): void {
    if (this.muted) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const bufLen = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
  }

  // ── Game sounds ────────────────────────────────────────────────────────

  /**
   * Playful "bwip" paddle hit.
   * Pitch maps to speed (330–660 Hz), bends up 100 Hz over 30ms.
   * Edge hits use triangle wave + 30 cent detune for a softer off-pitch feel.
   * @param speed       ball speed in px/s
   * @param edgeFactor  0 = center hit, 1 = edge hit
   */
  playPaddleHit(speed: number, edgeFactor = 0): void {
    if (this.muted || this.postGoalSilence > 0) return;
    const actx = this.getCtx();
    const now = actx.currentTime;

    // Map speed → freq: 330 Hz (slow) to 660 Hz (fast)
    const t = Math.min(Math.max((speed - 300) / 420, 0), 1);
    const freq = 330 + t * 330;
    const isEdge = edgeFactor > 0.5;

    const osc = actx.createOscillator();
    const gain = actx.createGain();

    osc.type = isEdge ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.linearRampToValueAtTime(freq + 100, now + 0.03); // pitch bend up
    if (isEdge) osc.detune.setValueAtTime(30, now); // +30 cents softer detune

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  /** Lighter wall bounce — no hitstop, softer timbre */
  playWallBounce(): void {
    if (this.postGoalSilence > 0) return;
    this.osc('square', 200, 0.12, 0.045);
  }

  /**
   * Goal scored — dramatic "BWOOOooom": low boom layered with descending sweep.
   * @param isLegendary  true when a 20+ hit rally just ended — longer silence
   */
  playGoal(isLegendary = false): void {
    if (this.muted) return;
    const actx = this.getCtx();
    const now = actx.currentTime;

    // Impact boom: 80 Hz sine, gain 0.4, exponential decay over 300ms
    const boom = actx.createOscillator();
    const boomGain = actx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(80, now);
    boomGain.gain.setValueAtTime(isLegendary ? 0.55 : 0.4, now);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + (isLegendary ? 0.45 : 0.3));
    boom.connect(boomGain);
    boomGain.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.5);

    // Descending sweep: 500 Hz → 100 Hz over 400ms
    const sweep = actx.createOscillator();
    const sweepGain = actx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(isLegendary ? 650 : 500, now);
    sweep.frequency.linearRampToValueAtTime(100, now + 0.4);
    sweepGain.gain.setValueAtTime(0.2, now);
    sweepGain.gain.linearRampToValueAtTime(0, now + 0.4);
    sweep.connect(sweepGain);
    sweepGain.connect(this.masterGain);
    sweep.start(now);
    sweep.stop(now + 0.41);

    // Silence: contrast between the boom and quiet is the drama
    // Legendary rallies earn a longer, more reverent pause
    this.postGoalSilence = isLegendary ? 900 : 500;

    // Exhale breath tone (~380ms after impact, during the silence)
    // osc() bypasses postGoalSilence — that's intentional, the exhale IS the silence
    setTimeout(() => {
      if (!this.muted && this.ctx) {
        this.osc('sine', 160, 0.04, 0.5, 80); // quiet descending sigh
      }
    }, 380);
  }

  /**
   * Set rally drone intensity. tier 0 = silence, 1–4 = building→legendary.
   * Uses a persistent oscillator so there's no click on tier changes.
   */
  setRallyDrone(tier: number): void {
    if (this.muted && tier > 0) return;

    // Lazy init
    if (!this.droneOsc && tier > 0) {
      const actx = this.getCtx();
      this.droneOsc  = actx.createOscillator();
      this.droneGain = actx.createGain();
      this.droneOsc.type = 'sine';
      this.droneOsc.frequency.value = 65;
      this.droneGain.gain.value = 0;
      this.droneOsc.connect(this.droneGain);
      this.droneGain.connect(this.masterGain);
      this.droneOsc.start();
    }

    if (!this.droneGain || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Target gain and pitch per tier — deeper and louder as intensity builds
    const gains = [0, 0.032, 0.060, 0.090, 0.140];
    const freqs = [65,  62,   58,   54,   50  ];

    this.droneGain.gain.setTargetAtTime(gains[Math.min(tier, 4)], now, tier === 0 ? 0.3 : 0.8);
    this.droneOsc!.frequency.setTargetAtTime(freqs[Math.min(tier, 4)], now, 1.0);
  }

  /** Serve countdown beep (pass beepIndex 0, 1, 2) */
  playCountdownBeep(beepIndex: number): void {
    const freq = beepIndex === 2 ? 1100 : 720;
    const vol = beepIndex === 2 ? 0.28 : 0.18;
    this.osc('sine', freq, vol, beepIndex === 2 ? 0.22 : 0.08);
  }

  /** Match win — ascending arpeggio */
  playMatchWin(): void {
    const notes = [262, 330, 392, 523]; // C E G C
    notes.forEach((hz, i) => {
      setTimeout(() => this.osc('sine', hz, 0.3, 0.18), i * 110);
    });
  }

  /** Turbo shot activated */
  playTurboActivate(): void {
    this.osc('sawtooth', 280, 0.2, 0.18, 980);
  }

  /** Slow field activated */
  playSlowFieldActivate(): void {
    this.osc('sine', 100, 0.18, 0.6);
  }

  /** Curve shot activated */
  playCurveActivate(): void {
    this.osc('square', 440, 0.08, 0.1);
    setTimeout(() => this.osc('square', 660, 0.12, 0.08), 60);
  }

  /** Shield spawned */
  playShieldSpawn(): void {
    this.osc('triangle', 580, 0.2, 0.12);
  }

  /** Shield shattered */
  playShieldBreak(): void {
    this.noise(0.2, 0.12);
    this.osc('sine', 400, 0.15, 0.2, 120);
  }

  /** Upgrade purchased */
  playUpgradePurchase(): void {
    this.osc('sine', 980, 0.22, 0.07);
    setTimeout(() => this.osc('sine', 1320, 0.22, 0.09), 75);
  }

  /** Cooldown ready ping */
  playCooldownReady(): void {
    this.osc('sine', 480, 0.12, 0.06);
  }

  /** Menu navigation click */
  playMenuNav(): void {
    this.osc('sine', 280, 0.1, 0.04);
  }

  /** Menu confirm */
  playMenuConfirm(): void {
    this.osc('sine', 480, 0.15, 0.07);
  }

  /** "SPIN" discovery moment — brief magical shimmer */
  playSpinDiscovery(): void {
    [800, 1000, 1200, 1000].forEach((hz, i) => {
      setTimeout(() => this.osc('sine', hz, 0.08, 0.1), i * 60);
    });
  }
}
