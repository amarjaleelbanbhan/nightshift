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
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // Integration tests spawn `node dist/index.js` as a child process; v8 coverage only
      // instruments the in-process worker, so nothing those tests exercise is credited here.
      // These numbers are therefore in-process (unit/in-test-import) coverage only.
      //
      // That blind spot is large and it is *deliberate*: driving the real built binary is what
      // catches wiring and ESM failures, so the suite keeps doing it and keeps paying for it in
      // uncredited coverage. 470 of 1207 statements (39%) sit in 13 files that measure exactly
      // 0% here - `src/index.ts`, every `src/cli/commands/*.ts`, `src/cli/interactive/home.ts`,
      // the UI render helpers - while being exercised by the subprocess suite on every run.
      //
      // So the thresholds are split rather than set to one number:
      //
      //   * The **global** floor is a tripwire, not a goal. It is set a few points under the
      //     measured 53.68% so that deleting tests trips it, while adding one more
      //     subprocess-only command module does not. Raising it toward 70% would not buy
      //     verification - it would buy pressure to rewrite good integration tests as worse
      //     unit tests, which is the one outcome this suite must not reward.
      //   * The **engine** glob is the real gate. Everything under core/adapters/backup/
      //     security/utils is pure, in-process-importable, and contains every path that writes
      //     to the user's configuration, so coverage there means what it says. Measured
      //     94.20/87.67/97.02/96.85; held a couple of points below that.
      //
      // Glob thresholds do *not* remove their files from the global calculation (verified by
      // raising both to 100 and reading the two reported percentages), so the global figure
      // below really is the whole-repo number.
      thresholds: {
        statements: 50,
        branches: 42,
        functions: 50,
        lines: 52,
        "src/{core,adapters,backup,security,utils}/**/*.ts": {
          statements: 92,
          branches: 85,
          functions: 94,
          lines: 95,
        },
      },
    },
  },
});
