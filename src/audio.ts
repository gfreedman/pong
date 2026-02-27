// AudioManager — all sounds synthesized via Web Audio API, no audio files

export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;
  private masterGain!: GainNode;

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
   * Pitch-matched paddle hit: slow ball = low tok, fast ball = high TAK.
   * Also encodes contact position (center vs edge) as slight timbre shift.
   * @param speed       ball speed in px/s
   * @param edgeFactor  0 = center hit, 1 = edge hit
   */
  playPaddleHit(speed: number, edgeFactor = 0): void {
    const minSpeed = 300, maxSpeed = 720;
    const t = Math.min(Math.max((speed - minSpeed) / (maxSpeed - minSpeed), 0), 1);

    // Center: 320–700 Hz sine; Edge: 420–900 Hz with slight detune (more clicky)
    const baseFreq = 320 + t * 380;
    const freq = baseFreq + edgeFactor * 200;
    const type: OscillatorType = edgeFactor > 0.5 ? 'triangle' : 'sine';
    const vol = 0.22 + t * 0.12;

    this.osc(type, freq, vol, 0.07 + t * 0.02);

    // Subtle "click" transient for edge hits
    if (edgeFactor > 0.4) {
      this.osc('square', freq * 2, 0.06, 0.015);
    }
  }

  /** Lighter wall bounce — no hitstop, softer timbre */
  playWallBounce(): void {
    this.osc('square', 200, 0.12, 0.045);
  }

  /** Goal scored — dramatic descending sweep */
  playGoal(): void {
    this.osc('sine', 580, 0.35, 0.35, 180);
    setTimeout(() => this.osc('sine', 300, 0.2, 0.25, 100), 200);
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
