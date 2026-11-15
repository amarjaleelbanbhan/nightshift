// Imported from `core/config/errors.js`, not `core/config/store.js`. Deliberate and measured:
// this module is loaded on every invocation (it holds the top-level handler), and `store.ts`
// builds a zod schema at module scope - so importing the class from there put 228 ms of zod on
// the startup path of `--version`. See docs/development/PERFORMANCE_REPORT.md.
import { ConfigCorruptError } from "../core/config/errors.js";
import { FileTooLargeError } from "../security/limits.js";
import { errorMessage } from "./ui/feedback.js";

/**
 * NIGHTSHIFT's exit-code contract. Documented in `docs/ARCHITECTURE.md` ("Exit codes");
 * changing a value here is a breaking change for anything that scripts the CLI.
 *
 * Deliberately three values. Commander already exits 1 for every usage error it detects
 * (unknown command, missing required argument, a bare command group) - verified by running
 * the built binary - so usage errors share 1 rather than being forced onto a code of their
 * own via `exitOverride()`. Fighting Commander here would buy a distinction no caller asked
 * for at the price of reimplementing its help/version exit behaviour.
 */
export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_CONFIG_CORRUPT = 2;

/**
 * An error already phrased for the user, carrying the exit code it should produce and an
 * optional next step.
 *
 * The `hint` exists so a command can add context to an error from a lower layer and rethrow,
 * rather than catching it to print its own message - which is how `runRestore` ended up with a
 * second, divergent copy of the top-level handler (A-11).
 */
export class NightshiftError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: number = EXIT_FAILURE, hint?: string) {
    super(message);
    this.name = "NightshiftError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/**
 * Turns any thrown value - `Error`, `NightshiftError`, or something that is not an error at
 * all - into a user-facing message and an exit code.
 */
export function describeError(error: unknown): {
  message: string;
  exitCode: number;
  hint?: string | undefined;
} {
  if (error instanceof NightshiftError) {
    return { message: error.message, exitCode: error.exitCode, hint: error.hint };
  }
  // A broken config.json gets its own code so a script can tell "delete config.json and
  // re-init" apart from "that theme id does not exist". Both error types already name the
  // offending file path in their message.
  if (error instanceof ConfigCorruptError || error instanceof FileTooLargeError) {
    return { message: error.message, exitCode: EXIT_CONFIG_CORRUPT };
  }
  if (error instanceof Error) {
    return { message: error.message, exitCode: EXIT_FAILURE };
  }
  return { message: String(error), exitCode: EXIT_FAILURE };
}

/**
 * The single place an escaped throw becomes output. Invoked from `src/index.ts` so that file
 * stays wiring-only.
 *
 * Sets `process.exitCode` rather than calling `process.exit()`: this CLI's output is tables,
 * and `process.exit()` truncates buffered stdout.
 *
 * Rendered through `errorMessage()` so an escaped throw gets the same `✗` glyph and `→ hint`
 * shape as a command's own failure - the glyph is what carries the meaning when color is off.
 */
export function reportFatal(error: unknown): void {
  const { message, exitCode, hint } = describeError(error);
  console.error(errorMessage(message, hint));
  process.exitCode = exitCode;
}

/**
 * The degraded-reader advisory: `status`, `theme list` and `profile list` keep rendering when
 * `config.json` is the broken thing, and name the corruption on stderr instead of aborting.
 *
 * One function rather than the same three lines in three commands - and it goes through
 * `errorMessage()`, so the advisory keeps the `✗` glyph that carries the meaning when color is
 * off. Printed with the raw message and no marker, a `NO_COLOR` user saw an undistinguished
 * line of text on stderr.
 */
export function reportConfigCorrupt(error: Error): void {
  console.error(
    errorMessage(
      error.message,
      "Output above is incomplete: anything read from the config (active theme, active profile) is shown as unset.",
    ),
  );
  process.exitCode = EXIT_CONFIG_CORRUPT;
}
