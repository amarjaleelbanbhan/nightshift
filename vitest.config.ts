import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The integration tests spawn the real built binary, and a single `node dist/index.js`
    // invocation measures 800-1400ms on Windows (measured over 5 runs of `--version`).
    // A test making 5+ sequential invocations therefore needs ~5s of pure process startup, which
    // sat right on vitest's 5000ms default - so under parallel file execution a *different*
    // integration test timed out on each run. That was real flakiness, not a code regression.
    // Raised deliberately rather than by trial and error; the underlying startup cost is tracked
    // as G18 and lowering it is the actual fix.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
