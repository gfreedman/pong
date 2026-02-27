# 🏓 NEON PONG — Claude Code Implementation Plan

> **Canvas-based Pong with upgrades, multiple modes, and juice.**
> Inspired architecturally and visually by [gfreedman/tic-tac-toe](https://github.com/gfreedman/tic-tac-toe).

---

## 0. REFERENCE REPO — What to Carry Forward

The tic-tac-toe repo establishes patterns we should mirror exactly:

| Pattern | How We Adopt It |
|---|---|
| **TypeScript + esbuild** | Same toolchain. Strict mode, ES2020 target, single `dist/script.js` output. |
| **Modular architecture** | Same one-directional dependency graph: `main → Game → [Engine, Audio, UI, Upgrades]` |
| **Dark neon theme** | Deep navy `#0a0a2e` background, cyan `#00f0ff` and magenta `#ff00aa` accents. Neon glow via `box-shadow` / canvas `shadowBlur`. |
| **Web Audio API** | Synthesized tones for paddle hits, wall bounces, scoring, upgrades — no audio files. |
| **No frameworks** | Vanilla TypeScript only. No React, no Pixi, no dependencies beyond esbuild. |
| **CSS screen transitions** | Menu → Mode Select → Game uses 300ms fade transitions with input lock to prevent double-clicks. |
| **Session scoreboard** | Persistent across rounds with animated score bumps. |
| **Keyboard-first** | Full keyboard control with clear mappings. |
| **Node test runner** | `node --test` with zero test-framework dependencies. |
| **GitHub Actions CI** | Build + test on push. |
| **Single HTML shell** | `index.html` loads `style.css` + `dist/script.js`. Canvas element lives here. |

---

## 1. GAME VISION

**Elevator pitch (Zynga PM lens):** Classic Pong with a modern neon aesthetic, session progression through match play, and a lightweight upgrade meta-layer that creates "just one more match" replayability — all in a zero-install browser tab.

**Design pillars:**
1. **Juice** — screen shake, particle trails, speed lines, hit-flash. Every interaction has feedback.
2. **Depth via simplicity** — Pong mechanics are instantly understood. Upgrades and modes layer on mastery.
3. **Session stickiness** — Match mode (first to 10) creates narrative arcs. Upgrade currency carries across matches.

---

## 2. GAME MODES

### 2.1 Quick Play (Single Rally Mode)
- Casual, no score target. Play indefinitely.
- Good for warming up or testing upgrades.

### 2.2 Match Mode — First to 10
- **The core mode.** First player to 10 points wins the match.
- Between-point "serve" ritual: 1.5s countdown with ball pulsing at center.
- Winner announced with full confetti + glow sequence.
- Match stats shown on end screen: rally lengths, longest rally, upgrade usage, avg ball speed.

### 2.3 Time Attack (60 Seconds)
- Score as many goals as possible in 60 seconds.
- Ball speed ramps every 15 seconds. Frantic pacing.
- Great for solo play against AI as a "beat your high score" loop.

### 2.4 Survival Mode
- Single player vs AI. You start with 5 lives. AI has infinite.
- Ball speeds up slightly after every successful return.
- How long can you last? Leaderboard tracked per session.

### 2.5 Player vs Player (Local)
- Two players, one keyboard. Left player: W/S. Right player: ↑/↓.
- Available in Quick Play and Match Mode.

### 2.6 Player vs AI
- Three difficulty tiers (mirrors tic-tac-toe):
  - **Easy** — AI moves toward ball with jitter and reaction delay (~250ms).
  - **Medium** — AI predicts ball trajectory, 80% tracking accuracy, occasional whiff.
  - **Hard** — AI predicts trajectory with spin compensation, uses upgrades strategically, nearly perfect but beatable with clever angle play.

---

## 3. UPGRADE SYSTEM

**Currency: Neon Sparks ⚡**
- Earned: 1 spark per point scored, 5 bonus for winning a match, 2 for a rally > 10 hits.
- Sparks persist within a browser session (in-memory, no localStorage).
- Displayed in HUD top-center.

### 3.1 Passive Upgrades (Purchased Between Matches)

| Upgrade | Cost | Effect | Max Level |
|---|---|---|---|
| **Wide Paddle** | 5⚡ | Paddle width +20% per level | 3 |
| **Sticky Paddle** | 8⚡ | Ball sticks on contact; release with action key. Allows aimed shots. | 1 |
| **Magnet** | 10⚡ | Paddle gently attracts ball when within 80px. Subtle, not game-breaking. | 1 |
| **Speed Boots** | 6⚡ | Paddle movement speed +15% per level | 3 |
| **Brick Wall** | 12⚡ | Paddle has a 2px-wider "sweet spot" in center that returns ball faster | 1 |
| **Trail Blazer** | 3⚡ | Purely cosmetic — your paddle leaves a neon comet trail | 1 |

### 3.2 Active Abilities (In-Game Key Press)

| Ability | Key | Cooldown | Effect |
|---|---|---|---|
| **Turbo Shot** | `E` (P1) / `L` (P2) | 8 seconds | Next paddle hit launches ball at 2× speed for 1 second, then normalizes. Ball glows bright. |
| **Slow Field** | `Q` (P1) / `K` (P2) | 12 seconds | Creates a visible "slow zone" on your half — ball decelerates 50% while inside. Lasts 3s. |
| **Phase Shift** | `R` (P1) / `;` (P2) | 15 seconds | Ball becomes semi-transparent and passes through opponent's paddle once. Telegraphed with visual warning. |
| **Shield Pulse** | `W` (for P1 when using arrows) / `O` (P2) | 10 seconds | Spawns a temporary barrier 40px in front of your paddle. Blocks one hit, then shatters. |

> **Design note (Ubisoft game designer lens):** Active abilities have generous cooldowns and strong visual/audio telegraphing so they feel powerful without being frustrating. The opponent always has time to react or counter.

### 3.3 Upgrade Shop Screen
- Appears between matches or accessible from pause menu.
- Shows current sparks, owned upgrades, and available purchases.
- Clean grid layout with neon-bordered cards. Purchased items glow solid.

---

## 4. VISUAL DESIGN (Canvas Bitmap)

### 4.1 Canvas Setup
- Fixed logical resolution: **960 × 540** (16:9), CSS-scaled to fit viewport.
- `imageSmoothingEnabled = false` for crisp pixel edges where desired.
- Double-buffer: draw to offscreen canvas, blit to visible canvas each frame.
- Target: 60fps via `requestAnimationFrame`.

### 4.2 Color Palette

| Element | Color | Hex |
|---|---|---|
| Background | Deep space navy | `#0a0a2e` |
| Center line / court markings | Dim cyan | `#00f0ff` @ 20% alpha |
| Player 1 paddle | Cyan neon | `#00f0ff` |
| Player 2 / AI paddle | Magenta neon | `#ff00aa` |
| Ball | White-hot core | `#ffffff` core, `#00f0ff` glow |
| Score text | White | `#ffffff` |
| Spark currency | Electric yellow | `#ffe600` |
| Slow field | Blue tint | `#0044ff` @ 15% alpha |
| Turbo effect | Orange-red | `#ff4400` with motion blur |

### 4.3 Visual Effects (The "Juice")

| Effect | Trigger | Implementation |
|---|---|---|
| **Paddle hit flash** | Ball contacts paddle | Paddle flashes white for 2 frames. Screen shake 2px for 3 frames. |
| **Ball trail** | Always | Store last 8 ball positions. Draw with decreasing alpha + radius. |
| **Speed lines** | Ball speed > threshold | Draw 3-5 thin lines behind ball in direction of travel. |
| **Goal explosion** | Point scored | 30-50 particles burst from the scoring side in opponent's color. |
| **Confetti** | Match win | Full-screen particle shower, cyan + magenta + white. 3 seconds. |
| **Screen shake** | Goal scored | Offset canvas draw by random ±4px for 200ms. |
| **Score pop** | Point scored | Score number scales up 150% then eases back over 400ms. |
| **Ball pulse** | Serve countdown | Ball radius oscillates ±2px at 2Hz during countdown. |
| **Neon glow** | Paddles + ball | `shadowBlur = 15`, `shadowColor` matching element color. |
| **Slow zone vis** | Slow Field active | Semi-transparent blue rectangle with animated scanlines. |
| **Turbo aura** | Turbo Shot active | Ball surrounded by orange/red flame particle ring. |
| **Phase ghost** | Phase Shift active | Ball rendered at 40% alpha with a "glitch" offset copy. |
| **Shield barrier** | Shield Pulse active | Glowing vertical bar, shatters into fragments when hit. |
| **Cooldown indicators** | Abilities on cooldown | Small circular radial-fill icons near each player's side. |

### 4.4 HUD Layout

```
┌─────────────────────────────────────────────────────┐
│  [P1 Abilities]     7  ⚡23  3     [P2 Abilities]   │
│                        ───                           │
│                     MATCH: 10                        │
│                                                      │
│  ┃                     │                         ┃   │
│  ┃                     │            ○             ┃   │
│  ┃                     │                         ┃   │
│                        │                             │
│                                                      │
│              RALLY: 12        BEST: 24               │
│  [Q] Slow 3s   [E] Turbo ✓   Timer/Mode info        │
└─────────────────────────────────────────────────────┘
```

---

## 5. PHYSICS & GAMEPLAY

### 5.1 Ball Physics
- Base speed: 5 px/frame, increases 0.15 px/frame each paddle hit (capped at 12).
- Angle determined by **where on the paddle** the ball hits:
  - Center → shallow angle (nearly horizontal).
  - Edges → steep angle (up to ±60°).
- Ball Y-velocity component is also influenced by paddle movement direction at moment of contact (adds spin feel).
- Wall bounces (top/bottom) reflect Y-velocity, play bounce tone.

### 5.2 Paddle Physics
- Height: 80px base (modified by Wide Paddle upgrade).
- Speed: 6 px/frame base (modified by Speed Boots upgrade).
- Smooth acceleration: 0→max over 3 frames. Deceleration over 2 frames when key released.
- Paddles clamped to canvas bounds.

### 5.3 Serving
- After a goal, ball resets to center.
- 1.5s countdown ("3… 2… 1…") with ball pulsing.
- Ball launches toward the player who was scored ON (they get to receive).
- Launch angle: random between ±30° from horizontal.

### 5.4 Collision Detection
- AABB rectangle-vs-rectangle for paddle-ball collision.
- Top/bottom wall collision checked each frame.
- Left/right boundary crossing = goal.
- Tunneling prevention: if ball speed > paddle width, use swept collision (check intermediate positions).

---

## 6. ARCHITECTURE

### 6.1 Dependency Graph

```
main.ts ──→ Game ──→ PhysicsEngine   (pure: ball movement, collision, angles)
                 ──→ AIController     (pure: difficulty strategies, move decisions)
                 ──→ AudioManager     (Web Audio API, no DOM)
                 ──→ Renderer         (all canvas drawing)
                 ──→ ParticleSystem   (particle effects, explosions, confetti)
                 ──→ UpgradeManager   (spark tracking, shop state, ability cooldowns)
                 ──→ InputManager     (keyboard state, key bindings)
```

### 6.2 Module Breakdown

| File | Class/Export | Responsibility |
|---|---|---|
| `src/types.ts` | — | All shared types, interfaces, enums, constants. `GameState`, `GameMode`, `Difficulty`, `UpgradeId`, `AbilityId`, `Particle`, `Player`, `Ball`. |
| `src/constants.ts` | — | All magic numbers: canvas size, speeds, colors, cooldowns, upgrade costs, physics tuning. Single source of truth. |
| `src/physics.ts` | `PhysicsEngine` | Static methods. `updateBall()`, `checkPaddleCollision()`, `checkWallBounce()`, `checkGoal()`, `calculateReflection()`, `applySpinFromPaddle()`. Pure functions — take state in, return new positions/velocities. |
| `src/ai.ts` | `AIController` | Static methods. `getTargetY(ball, difficulty)` → returns where AI paddle should move. Easy: delayed reaction + jitter. Medium: trajectory prediction with error. Hard: near-perfect prediction + ability usage. |
| `src/audio.ts` | `AudioManager` | Web Audio API. Methods: `playPaddleHit()`, `playWallBounce()`, `playGoal()`, `playMatchWin()`, `playCountdown()`, `playUpgradePurchase()`, `playAbilityActivate()`, `playAbilityCooldownReady()`. Mute toggle via closure. All synthesized — no audio files. |
| `src/particles.ts` | `ParticleSystem` | Manages particle pools. `emitGoalExplosion()`, `emitConfetti()`, `emitShieldShatter()`, `emitTurboFlame()`. `update()` and `draw(ctx)` called each frame. Object pooling to avoid GC pressure. |
| `src/renderer.ts` | `Renderer` | All canvas drawing. `drawBackground()`, `drawCourt()`, `drawPaddles()`, `drawBall()`, `drawHUD()`, `drawCountdown()`, `drawUpgradeShop()`, `drawMenuScreen()`, `drawModeSelect()`, `drawEndScreen()`. Handles screen shake offset. |
| `src/upgrades.ts` | `UpgradeManager` | Spark balance, purchased upgrades map, active ability cooldowns, `canAfford()`, `purchase()`, `activateAbility()`, `tickCooldowns()`, `getModifiedPaddleWidth()`, `getModifiedPaddleSpeed()`. |
| `src/input.ts` | `InputManager` | Tracks pressed keys via `keydown`/`keyup`. Methods: `isKeyDown(key)`, `wasKeyPressed(key)` (single-fire). Handles both player keybinds. |
| `src/game.ts` | `Game` | Orchestrator. Owns the game loop (`requestAnimationFrame`). State machine: `MENU → MODE_SELECT → DIFFICULTY_SELECT → SIDE_SELECT → PLAYING → PAUSED → POINT_SCORED → MATCH_END → UPGRADE_SHOP`. Delegates all drawing to `Renderer`, all physics to `PhysicsEngine`. |
| `src/main.ts` | — | Bootstrap: create canvas, instantiate all modules, wire events, start. Exports for tests. |

### 6.3 Game Loop (Inside `Game`)

```
gameLoop(timestamp):
    deltaTime = timestamp - lastTimestamp
    lastTimestamp = timestamp

    if state == PLAYING:
        InputManager.update()
        updatePaddles(deltaTime)          // Player input + AI movement
        UpgradeManager.tickCooldowns(deltaTime)
        checkAbilityActivations()
        PhysicsEngine.updateBall(state)
        PhysicsEngine.checkWallBounce(state)    → AudioManager.playWallBounce()
        PhysicsEngine.checkPaddleCollision(state) → AudioManager.playPaddleHit(), screenShake()
        PhysicsEngine.checkGoal(state)          → handleGoal()

    if state == POINT_SCORED:
        updateServeCountdown(deltaTime)

    ParticleSystem.update(deltaTime)

    // === DRAW PHASE ===
    Renderer.clear()
    Renderer.drawBackground()
    Renderer.drawCourt()

    if state == MENU:          Renderer.drawMenuScreen()
    if state == MODE_SELECT:   Renderer.drawModeSelect()
    if state == PLAYING:       Renderer.drawGame(state, particles)
    if state == PAUSED:        Renderer.drawGame(state, particles) + Renderer.drawPauseOverlay()
    if state == POINT_SCORED:  Renderer.drawGame(state, particles) + Renderer.drawCountdown()
    if state == MATCH_END:     Renderer.drawEndScreen(stats)
    if state == UPGRADE_SHOP:  Renderer.drawUpgradeShop(upgrades, sparks)

    ParticleSystem.draw(ctx)
    requestAnimationFrame(gameLoop)
```

### 6.4 State Machine

```
          [MENU]
            │
       ┌────┴────┐
       ▼          ▼
 [QUICK_PLAY]  [MODE_SELECT] ──→ [DIFFICULTY_SELECT] ──→ [SIDE_SELECT]
       │          │                                            │
       └────┬─────┘                                            │
            ▼                                                  │
        [PLAYING] ◄────────────────────────────────────────────┘
         │     │
    Esc  │     │ Goal
         ▼     ▼
    [PAUSED]  [POINT_SCORED]
      │  │         │
      │  └─Resume──┘ (after countdown)
      │
      └──→ [UPGRADE_SHOP] ──→ [PLAYING] (via "Continue")
      └──→ [MENU] (via "Quit")

    [PLAYING] ──→ score == 10 ──→ [MATCH_END]
                                       │
                                  ┌────┴────┐
                                  ▼          ▼
                           [UPGRADE_SHOP]  [MENU]
```

---

## 7. AUDIO DESIGN

All synthesized via Web Audio API (same pattern as tic-tac-toe's `AudioManager`):

| Sound | Synthesis | Character |
|---|---|---|
| Paddle hit | Short 440Hz sine, fast decay | Clean "tok" |
| Wall bounce | 220Hz square, very short | Soft "tik" |
| Goal scored | Descending tone sweep 600→200Hz, 300ms | Dramatic "wooomm" |
| Countdown beep | 800Hz sine, 80ms, 3× | "bip bip bip" |
| Countdown GO | 1200Hz sine, 200ms | Higher pitch "BIIP" |
| Match win | Ascending arpeggio C-E-G-C, sine | Triumphant jingle |
| Turbo activate | Rising frequency sweep 300→1000Hz, 150ms | Whoosh up |
| Slow field | Low 100Hz hum, sustained while active | Ominous drone |
| Phase shift | Bitcrushed blip (square wave + detune) | Glitchy "bzzt" |
| Shield spawn | 600Hz triangle, 100ms | Metallic "ting" |
| Shield break | Noise burst + descending tone | Shatter |
| Upgrade purchase | Coin sound: 1000Hz sine × 2 quick hits | "ka-ching" |
| Cooldown ready | Subtle 500Hz ping, 50ms | Notification chime |
| Menu navigate | 300Hz sine, 30ms | Soft click |
| Menu select | 500Hz sine, 60ms | Confirm click |

---

## 8. CONTROLS

| Action | Player 1 | Player 2 (Local PvP) |
|---|---|---|
| Move up | `W` or `↑` | `↑` (P1 uses W/S in PvP) |
| Move down | `S` or `↓` | `↓` |
| Turbo Shot | `E` | `L` |
| Slow Field | `Q` | `K` |
| Phase Shift | `R` | `;` |
| Shield Pulse | `F` | `'` |
| Pause | `Escape` | `Escape` |
| Menu select | `Enter` / `Space` | — |
| Menu navigate | `↑` / `↓` | — |

In PvP mode, Player 1 is locked to `W/S` + `Q/E/R/F` and Player 2 to `↑/↓` + `K/L/;/'`.

---

## 9. SCREENS & NAVIGATION

### 9.1 Main Menu
```
        ╔══════════════════════╗
        ║     NEON  PONG       ║  ← Title with glow pulse animation
        ╠══════════════════════╣
        ║   ▸ Quick Play       ║
        ║     Match Mode       ║
        ║     Time Attack      ║
        ║     Survival         ║
        ╠══════════════════════╣
        ║     [Upgrade Shop]   ║  ← Only if sparks > 0
        ╚══════════════════════╝
```

### 9.2 Mode Selection (after choosing a mode)
```
        ╔══════════════════════╗
        ║  SELECT OPPONENT     ║
        ╠══════════════════════╣
        ║   ▸ Player vs AI     ║
        ║     Player vs Player ║
        ╚══════════════════════╝
```

### 9.3 AI Difficulty
```
        ╔══════════════════════╗
        ║    DIFFICULTY        ║
        ╠══════════════════════╣
        ║   ▸ Easy    🟢       ║
        ║     Medium  🟡       ║
        ║     Hard    🔴       ║
        ╚══════════════════════╝
```

### 9.4 Side Select
```
        ╔══════════════════════╗
        ║   CHOOSE YOUR SIDE   ║
        ╠══════════════════════╣
        ║   ◄ LEFT (Cyan)      ║
        ║     RIGHT (Magenta) ►║
        ╚══════════════════════╝
```

### 9.5 Pause Overlay
- Semi-transparent dark overlay over frozen game state.
- Options: Resume, Upgrade Shop, Quit to Menu.

### 9.6 Match End Screen
```
        ╔══════════════════════════════╗
        ║     🏆 PLAYER 1 WINS! 🏆     ║  ← with confetti
        ╠══════════════════════════════╣
        ║   Final Score:  10 - 7       ║
        ║   Longest Rally: 24          ║
        ║   Turbo Shots Used: 3        ║
        ║   Sparks Earned: 17 ⚡        ║
        ╠══════════════════════════════╣
        ║   ▸ Upgrade Shop             ║
        ║     Rematch                  ║
        ║     Main Menu                ║
        ╚══════════════════════════════╝
```

---

## 10. PROJECT STRUCTURE

```
neon-pong/
├── index.html              Single-page HTML shell (canvas + style link + script)
├── style.css               Minimal CSS: body reset, canvas centering, menu overlays
├── package.json            Scripts: build, dev (watch), test
├── tsconfig.json           Strict, ES2020, DOM lib
├── .github/
│   └── workflows/
│       └── ci.yml          Build + test on push
├── src/
│   ├── types.ts            All shared types, interfaces, enums
│   ├── constants.ts        All tuning values, colors, sizes, speeds
│   ├── physics.ts          PhysicsEngine — ball updates, collision, reflection
│   ├── ai.ts               AIController — three difficulty strategies
│   ├── audio.ts            AudioManager — Web Audio synthesis
│   ├── particles.ts        ParticleSystem — pooled particle effects
│   ├── renderer.ts         Renderer — all canvas drawing
│   ├── upgrades.ts         UpgradeManager — sparks, shop, abilities, cooldowns
│   ├── input.ts            InputManager — keyboard state tracking
│   ├── game.ts             Game — state machine, game loop, orchestration
│   └── main.ts             Entry point — bootstrap, wiring, test exports
├── dist/
│   └── script.js           esbuild output
└── tests/
    └── pong.test.js        Node built-in test runner
```

---

## 11. IMPLEMENTATION ORDER (Claude Code Phases)

### Phase 1 — Scaffold & Core Loop
**Goal: Ball bouncing on screen with one paddle.**

1. `npm init`, install esbuild, create `tsconfig.json`, `package.json` scripts.
2. Create `index.html` with `<canvas>` element and basic CSS (centered, dark bg).
3. `types.ts` — define core types: `Ball`, `Paddle`, `GameState`, `GamePhase`.
4. `constants.ts` — canvas dimensions, colors, base speeds.
5. `input.ts` — `InputManager` with `keydown`/`keyup` tracking.
6. `renderer.ts` — `clear()`, `drawBackground()`, `drawPaddle()`, `drawBall()` with neon glow.
7. `physics.ts` — `updateBall()`, `checkWallBounce()`, `checkPaddleCollision()`, `checkGoal()`.
8. `game.ts` — minimal game loop: move ball, bounce off walls, one player paddle, detect goals.
9. `main.ts` — bootstrap, create canvas, start loop.
10. **Verify:** Ball moves, bounces off top/bottom, paddle moves with W/S, paddle collision works.

### Phase 2 — Two Players & Scoring
**Goal: Playable 2-player Pong with score.**

1. Add Player 2 paddle (right side), wire ↑/↓ keys.
2. Implement scoring: left/right boundary = opponent scores.
3. Add HUD: draw score numbers centered at top.
4. Implement serve sequence: countdown 3-2-1, ball launches.
5. `audio.ts` — `AudioManager` with paddle hit, wall bounce, goal, countdown sounds.
6. Add ball trail effect (store last 8 positions, draw with fading alpha).
7. Add paddle hit flash + screen shake.
8. Add goal explosion particles → `particles.ts` with `ParticleSystem`.
9. **Verify:** Two humans can play, score tracks, serve works, sounds play, effects fire.

### Phase 3 — AI Opponent
**Goal: Play against computer at three difficulties.**

1. `ai.ts` — `AIController` with Easy/Medium/Hard strategies.
2. Easy: move toward ball Y with delay + random jitter.
3. Medium: predict ball trajectory using velocity extrapolation, 80% accuracy.
4. Hard: perfect trajectory prediction, accounts for wall bounces, slight reaction delay to remain beatable.
5. Wire AI into game loop — when mode is PvAI, AI controls Player 2 paddle.
6. **Verify:** AI plays at three distinct skill levels. Hard is very good but not impossible.

### Phase 4 — Menu System & Game Modes
**Goal: Full menu navigation, all modes selectable.**

1. Add `GamePhase` states: `MENU`, `MODE_SELECT`, `DIFFICULTY_SELECT`, `SIDE_SELECT`, `PAUSED`, `MATCH_END`.
2. `renderer.ts` — draw each menu screen on canvas (no HTML overlays — everything on canvas).
3. Menu keyboard navigation: ↑/↓ to select, Enter to confirm, Escape to go back.
4. Implement Match Mode (first to 10) with match-end screen and stats.
5. Implement Time Attack (60s timer, ball speed ramp every 15s).
6. Implement Survival Mode (5 lives, progressive speed).
7. Implement pause overlay (Escape during play).
8. Screen transitions: fade-out/in via alpha interpolation over ~20 frames.
9. **Verify:** Can navigate all menus, play all modes, pause/resume, see match results.

### Phase 5 — Upgrade System
**Goal: Sparks, shop, passive upgrades, active abilities.**

1. `upgrades.ts` — `UpgradeManager`: spark tracking, upgrade purchase logic, ability cooldowns.
2. Implement spark earning: 1/point, 5/match win, 2/rally>10.
3. Implement passive upgrades: Wide Paddle, Speed Boots, Sticky Paddle, Magnet, Brick Wall, Trail Blazer.
4. Implement active abilities: Turbo Shot, Slow Field, Phase Shift, Shield Pulse.
5. `renderer.ts` — draw Upgrade Shop screen, ability cooldown indicators in HUD, active effect visuals.
6. `particles.ts` — add turbo flame, shield shatter, slow zone scanline effects.
7. `audio.ts` — add upgrade purchase, ability activate, cooldown ready sounds.
8. Wire abilities into physics: Turbo modifies ball speed, Slow Field creates decel zone, Phase Shift skips collision once, Shield is a secondary collision rect.
9. Hard AI: occasionally uses abilities when advantageous.
10. **Verify:** Can earn sparks, buy upgrades, use abilities in-game with proper visuals/audio/cooldowns.

### Phase 6 — Polish & Juice
**Goal: Make it *feel* incredible.**

1. Ball speed lines at high velocity.
2. Score pop animation (scale up/ease back).
3. Confetti on match win (full screen particle shower).
4. Ball pulse during serve countdown.
5. Smooth paddle acceleration/deceleration (not instant start/stop).
6. Court markings: dashed center line, center circle, goal zone markers.
7. Title screen animation: "NEON PONG" with letter-by-letter glow-in.
8. Rally counter displayed subtly at bottom-center during play.
9. Longest rally highlight if beaten during a match.
10. Responsive canvas sizing: fit to viewport, maintain 16:9.

### Phase 7 — Testing & CI
**Goal: Confidence in logic, automated builds.**

1. Physics tests: ball reflection angles, wall bounce, paddle collision at various positions, tunneling prevention.
2. AI tests: Easy never predicts trajectory, Medium uses prediction, Hard returns optimal positions.
3. Upgrade tests: spark math, purchase gating, cooldown timing, paddle width/speed modifications.
4. State machine tests: valid transitions, no skipped states.
5. Scoring tests: match mode ends at 10, time attack ends at 60s, survival decrements lives.
6. Input tests: key state tracking, single-fire detection.
7. GitHub Actions CI: `npm run build && npm test` on push.

---

## 12. ADDITIONAL IDEAS

*From the Ubisoft designer / Supercell engineer / Zynga PM roundtable:*

### Session Meta & Engagement (Zynga PM)
- **Daily Challenge:** "Win a match without using abilities" or "Score 5 goals in Time Attack with Turbo only" — grants bonus sparks. (One per session, randomly selected from a pool.)
- **Stats Dashboard:** Accessible from menu. Win/loss record, total sparks earned, favorite mode, average rally length.
- **Difficulty Unlock Teaser:** Hard AI locked until you beat Medium in Match Mode. Creates progression.

### Game Feel & Design (Ubisoft Designer)
- **Ball Curve/Spin:** If paddle is moving when it hits ball, apply slight curve to ball path. Creates a skill ceiling.
- **Dramatic Rallies:** After 15+ hits in a rally, court borders start pulsing, music tempo increases, ball trail gets longer. Heightens tension.
- **Near-Miss Indicator:** When ball passes within 5px of paddle edge without hitting, brief "!" flash and "whoosh" sound.
- **"Match Point" Call-out:** When either player is at 9 points, flash "MATCH POINT" with dramatic audio sting.
- **Power Serve:** Hold serve key longer for a faster initial serve (visual: ball pulses bigger the longer you hold).

### Technical Excellence (Supercell Engineer)
- **Frame-rate Independence:** All physics uses delta-time, never frame-count. Game plays identically at 30fps and 144fps.
- **Object Pooling:** Particles, trail points, and visual effects use pre-allocated pools. Zero runtime allocation during gameplay.
- **Render Layers:** Background (static) → Court (static) → Game objects (dynamic) → Particles (dynamic) → HUD (dynamic). Only redraw layers that changed.
- **Fixed Timestep Physics:** Physics runs at 120Hz fixed step, rendering interpolates. Prevents physics instability at low framerates.
- **Canvas State Optimization:** Batch `shadowBlur` changes (expensive). Group draws by shared canvas state.
- **Replay System (stretch):** Record input events + RNG seeds per frame. Allow replaying last rally or full match.

---

## 13. KEY CONSTANTS (Starting Values for Tuning)

```typescript
// Canvas
CANVAS_WIDTH = 960
CANVAS_HEIGHT = 540

// Ball
BALL_RADIUS = 6
BALL_BASE_SPEED = 5         // px per physics tick
BALL_SPEED_INCREMENT = 0.15 // per paddle hit
BALL_MAX_SPEED = 12
BALL_MAX_ANGLE = 60         // degrees from horizontal

// Paddle
PADDLE_WIDTH = 12
PADDLE_HEIGHT = 80
PADDLE_SPEED = 6            // px per physics tick
PADDLE_MARGIN = 20          // distance from edge
PADDLE_ACCEL_FRAMES = 3
PADDLE_DECEL_FRAMES = 2

// Serve
SERVE_COUNTDOWN_MS = 1500
SERVE_ANGLE_RANGE = 30      // degrees

// Modes
MATCH_TARGET_SCORE = 10
TIME_ATTACK_DURATION_S = 60
SURVIVAL_STARTING_LIVES = 5

// Upgrades
WIDE_PADDLE_BONUS = 0.2     // 20% per level
SPEED_BOOTS_BONUS = 0.15    // 15% per level
TURBO_SPEED_MULTIPLIER = 2
TURBO_DURATION_MS = 1000
SLOW_FIELD_DECEL = 0.5
SLOW_FIELD_DURATION_MS = 3000
SHIELD_OFFSET_PX = 40

// Cooldowns (ms)
TURBO_COOLDOWN = 8000
SLOW_FIELD_COOLDOWN = 12000
PHASE_SHIFT_COOLDOWN = 15000
SHIELD_COOLDOWN = 10000

// Sparks
SPARKS_PER_POINT = 1
SPARKS_MATCH_WIN = 5
SPARKS_LONG_RALLY = 2
LONG_RALLY_THRESHOLD = 10

// Visual
TRAIL_LENGTH = 8
SCREEN_SHAKE_INTENSITY = 4   // px
SCREEN_SHAKE_DURATION = 200  // ms
NEON_GLOW_RADIUS = 15
```

---

## 14. DONE CRITERIA

A "shippable" Neon Pong meets ALL of these:

- [ ] 960×540 canvas, responsive CSS scaling, 60fps
- [ ] Dark neon visual theme matching tic-tac-toe aesthetic
- [ ] Ball physics with angle-based paddle reflection and spin
- [ ] PvP (local) and PvAI with 3 difficulty levels
- [ ] Quick Play, Match (first to 10), Time Attack, Survival modes
- [ ] Full menu flow with keyboard navigation and screen transitions
- [ ] Serve countdown sequence
- [ ] 6 passive upgrades purchasable with Neon Sparks
- [ ] 4 active abilities with cooldowns and visual/audio feedback
- [ ] Upgrade Shop accessible from pause and post-match
- [ ] Web Audio synthesized sound for all interactions
- [ ] Particle effects: goal explosion, confetti, ball trail, ability FX
- [ ] Screen shake, score pop, hit flash
- [ ] HUD: scores, sparks, ability cooldowns, rally counter
- [ ] Match end screen with stats
- [ ] Pause/resume with overlay
- [ ] All physics delta-time based
- [ ] 40+ unit tests covering physics, AI, upgrades, scoring, state machine
- [ ] GitHub Actions CI passing
- [ ] README with architecture docs, controls, and screenshots
- [ ] GitHub Pages deployment

---

*Built with 🎮 by Claude Code — TypeScript, Canvas, and zero dependencies.*
