/**
 * `config.json` exists but could not be turned into a config. Thrown rather than returned by
 * `readConfig()`; `src/cli/errors.ts` maps it to the documented config exit code. The message
 * names the file and the remedy, because a hand-edited `config.json` is an expected input -
 * the README tells users where it lives.
 *
 * **This module must stay dependency-free.** It exists separately from `store.ts` for a measured
 * reason: `src/cli/errors.ts` holds the top-level error handler and is therefore imported
 * eagerly by `src/index.ts` on *every* invocation, and it needs this class for an `instanceof`
 * check. While the class lived in `store.ts`, that one `instanceof` dragged `store.ts`'s
 * module-scope zod schema onto the startup path of every command - **228 ms of zod on
 * `nightshift --version`**, which validates nothing. See `docs/development/PERFORMANCE_REPORT.md`.
 *
 * `store.ts` re-exports it, so every existing import site and the public surface are unchanged.
 */
export class ConfigCorruptError extends Error {
  constructor(configPath: string, detail: string) {
    super(
      `NIGHTSHIFT's configuration file could not be read: ${configPath}\n` +
        `  ${detail}\n` +
        "  Fix the file by hand, or delete it and run `nightshift init` to recreate it.",
    );
    this.name = "ConfigCorruptError";
  }
}
