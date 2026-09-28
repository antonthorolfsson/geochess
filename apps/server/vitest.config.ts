import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test file boots its own in-memory database and applies every migration; with several
    // files starting at once on a slow machine that can take longer than the 10-second default.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
