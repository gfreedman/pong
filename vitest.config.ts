/**
 * @file vitest.config.ts
 * @description Minimal Vitest configuration for Neon Pong unit tests.
 *
 * Vitest is chosen because it natively handles TypeScript (including the
 * `.js`-extension import style used throughout this codebase) with zero
 * tsconfig wrangling, and provides the familiar Jest-compatible API.
 *
 * `environment: 'node'` ensures tests run without any DOM or canvas stubs.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig(
{
  test:
  {
    /** No DOM required — physics and AI are pure logic. */
    environment: 'node',
  },
});
