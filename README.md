# Neon Pong

A polished, browser-based Pong built with vanilla TypeScript — no frameworks, no runtime dependencies.

Features a dark neon theme, spin physics, three AI difficulty levels, synthesised audio via the Web Audio API, and a full suite of game-feel effects: hitstop, screen shake, chromatic aberration, paddle breathing, and wall scorch marks.

**[Play it here](https://gfreedman.github.io/pong/)**

## Quick Start

```bash
npm install
npm run build                 # one-shot build → dist/script.js
npm run dev                   # watch mode with auto-rebuild
npm test                      # run all unit tests (vitest)
open index.html               # open in browser
```

## Features

- **Player vs AI** — single-player match against a spin-aware AI opponent
- **Three AI difficulties**
  - **Easy** — reacts slowly, ignores spin, aims for center
  - **Medium** — ballistic trajectory prediction with deliberate reaction delay
  - **Hard** — near-perfect prediction, minimal delay, adapts to spin
- **Spin physics** — paddle velocity imparts topspin/backspin; the ball curves in flight, shown via a comet trail and spin-line markers
- **Dark neon theme** — deep navy background with cyan (player) and magenta (AI) accents
- **Full hit feel** — hitstop (33–50 ms), squash/stretch, paddle recoil spring, chromatic aberration flash, impact ring, pitch-matched audio
- **Wall scorch marks** — each wall impact leaves a glowing brand that fades over 10 s
- **Paddle breathing** — 0.5 Hz idle oscillation; paddles sag on concede, jump on score
- **Screen shake** — on paddle hits and goals, intensity-scaled to rally speed
- **Rally escalation** — ball speeds up with every paddle touch; tension builds naturally
- **Spin discovery hint** — shown once after the player imparts spin for the first time
- **Serve ritual** — 3-2-1 countdown with the server's color, initiated by the scoring side
- **Pause** — Escape freezes everything; press again to resume
- **Responsive** — canvas scales to any viewport while preserving a 16:9 aspect ratio

## How to Play

1. Select a difficulty (**Easy**, **Medium**, or **Hard**) from the pre-match overlay
2. Press **W / S** to move your paddle (left side, cyan)
3. Hit the ball back to score — first to **5 points** wins
4. Use paddle movement while striking to impart spin and curve your shots
5. Press **Escape** to pause at any time

## Controls

| Key | Action |
|---|---|
| W / S | Move paddle up / down |
| Escape | Pause / unpause |
| Space / Enter | Serve the ball (during countdown) |

---

## Architecture

Eight TypeScript modules with a strict one-directional dependency graph:

```
main.ts  ──→  Game  ──→  InputManager    (key state, single-fire wasPressed)
                    ──→  AudioManager    (Web Audio API synthesis, no files)
                    ──→  Renderer        (canvas drawing only)
                    ──→  AIController   (prediction + difficulty strategies)
                    ──→  PhysicsEngine  (pure functions — updateBall, spin, springs)
```

### Module Overview

| File | Responsibility |
|---|---|
| `src/types.ts` | All shared types, interfaces, and game-phase enum |
| `src/constants.ts` | Every tuning value — single source of truth |
| `src/input.ts` | `InputManager` — keydown/keyup with single-fire `wasPressed` |
| `src/audio.ts` | `AudioManager` — Web Audio synthesis, no audio files |
| `src/physics.ts` | Pure functions: `updateBall`, collision, spin, springs |
| `src/renderer.ts` | `Renderer` — all canvas drawing: court, paddles, ball, HUD, effects |
| `src/ai.ts` | `AIController` — ballistic prediction, 3 difficulty strategies |
| `src/game.ts` | `Game` — state machine, RAF loop, DOM overlay management |
| `src/main.ts` | Bootstrap, DPR-aware canvas sizing, window resize handler |

### Key Design Decisions

- **Delta-time physics** — all velocities are in px/s and multiplied by `dt` each frame, so gameplay is frame-rate independent.
- **No DOM in physics/AI** — `PhysicsEngine` and `AIController` are pure; they read structs and return or mutate values without touching the DOM.
- **Canvas HUD, HTML overlays** — in-game scores, pips, and rally text are canvas-drawn by `Renderer`; the difficulty selector and end screen are HTML divs with glassmorphic CSS cards, keeping markup semantic and animatable.
- **Single constants file** — every magic number lives in `constants.ts` with JSDoc units (px, px/s, ms) so tuning feel requires touching exactly one file.
- **esbuild bundling** — modules use ES imports internally; esbuild bundles them into `dist/script.js` targeting ES2020.

---

## Game Logic Flow

### State Machine

```
DIFFICULTY_SELECT
      │
      └─ player picks difficulty
              │
              ▼
       SERVE_PENDING  ←──────────────────────────────┐
              │                                       │
              └─ Space / Enter                        │
                      │                              │
                      ▼                              │
                  SERVING  (3-2-1 countdown)         │
                      │                              │
                      ▼                              │
                  PLAYING  ←──── Escape ────→  PAUSED │
                      │                              │
                      ├─ ball misses paddle           │
                      │        │                     │
                      │        ▼                     │
                      │  POINT_SCORED (brief pause)  │
                      │        │                     │
                      │        └──── score < 5 ──────┘
                      │        │
                      │        └──── score = 5
                      │                 │
                      ▼                 ▼
                             MATCH_END  →  DIFFICULTY_SELECT
```

### AI Strategies

| Difficulty | Strategy | Accuracy |
|---|---|---|
| **Easy** | No trajectory prediction; drifts toward ball y with long reaction delay | Low |
| **Medium** | Ballistic prediction — traces ball path accounting for wall bounces; moderate delay | Medium |
| **Hard** | Ballistic + spin-curve prediction; short reaction delay; near-max movement speed | High |

All three strategies clamp paddle movement to a configurable max speed and add a small random wobble to remain beatable.

### Physics Pipeline (per frame)

```
InputManager.update()
    │
    └─ player paddle velocity applied via spring acceleration

AIController.update(ball, paddle, dt)
    │
    └─ predict target Y → move AI paddle toward it

PhysicsEngine.updateBall(state, dt)
    │
    ├─ apply spin curve (angular velocity → lateral acceleration)
    ├─ move ball by velocity × dt
    ├─ wall bounce (top / bottom)
    ├─ paddle collision (AABB + spin impart from paddle velocity)
    ├─ goal detection (left / right edge)
    └─ trail history update

Renderer.draw(state)
    │
    └─ court → scorch marks → paddles → trail → ball → HUD → effects
```

---

## Testing

Unit tests using [Vitest](https://vitest.dev/). No test framework dependencies beyond Vitest itself.

```bash
npm test
```

Test coverage:
- **AIController** — difficulty switching, state reset, movement clamping, prediction accuracy, EASY/MEDIUM/HARD strategy invariants
- **PhysicsEngine** — wall bounce, paddle collision, spin impart, speed escalation, goal detection, spring damping

---

## Project Structure

```
pong/
├── index.html              Single-page HTML shell
├── style.css               All styles (canvas, overlays, cards, animations)
├── package.json            Build scripts (esbuild + vitest)
├── tsconfig.json           TypeScript config (strict, ES2020, DOM)
├── src/
│   ├── types.ts            Shared types and game-phase state machine
│   ├── constants.ts        All tuning values (px, px/s, ms, colors)
│   ├── input.ts            InputManager — keyboard state tracking
│   ├── audio.ts            AudioManager — Web Audio API synthesis
│   ├── physics.ts          Pure physics functions
│   ├── renderer.ts         Renderer — all canvas drawing
│   ├── ai.ts               AIController — trajectory prediction + strategies
│   ├── game.ts             Game — state machine, RAF loop, orchestration
│   └── main.ts             Entry point — bootstrap and resize handler
├── tests/
│   ├── ai.test.ts          AIController unit tests
│   ├── physics.test.ts     PhysicsEngine unit tests
│   └── helpers.ts          Shared factory functions for test objects
└── dist/
    └── script.js           Bundled output (loaded by index.html)
```

## License

MIT
