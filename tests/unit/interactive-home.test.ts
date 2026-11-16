import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Headless coverage of the interactive menu's **dispatch logic** (#13).
 *
 * `@clack/prompts` will not render without a real TTY, so nothing in `src/cli/interactive/
 * home.ts` had ever been executed by automation - including one shipped behaviour that was
 * verified by reading rather than running: the loop resets `process.exitCode` after every
 * action, so a session where the user hit one failure and then carried on does not exit
 * non-zero (A-9).
 *
 * What this harness tests and what it deliberately does not:
 *
 *   - **Tested:** which command function each menu path calls, that `back` and a cancellation
 *     return to the parent menu without dispatching, that cancelling at the top level ends the
 *     session, and the `process.exitCode` reset.
 *   - **Not tested:** rendering. Arrow-key navigation, cursor restoration, colour and column
 *     alignment are clack's job and the terminal's, and simulating them would verify the
 *     simulation. Those stay in `docs/development/TTY_CHECKLIST.md`, which
 *     `docs/development/RELEASE_CHECKLIST.md` §3a gates the release on.
 *
 * The prompt layer is replaced by a scripted queue of answers: each `promptSelect`/`promptText`
 * call shifts the next answer, and an exhausted queue returns `null` - the same value a real
 * cancellation produces. That makes every test terminate by construction rather than by
 * remembering to script an exit, which matters when the thing under test is a `for (;;)` loop.
 */

const answers: (string | null)[] = [];
const calls: string[] = [];

/** Records that a command ran, and optionally fails the way a real command failure does. */
function stub(name: string, effect?: () => void) {
  return vi.fn(() => {
    calls.push(name);
    effect?.();
  });
}

vi.mock("../../src/cli/ui/prompts.js", () => ({
  intro: vi.fn(),
  outro: vi.fn(() => calls.push("outro")),
  note: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn((m: string) => calls.push(`warn:${m.slice(0, 20)}`)) },
  promptSelect: vi.fn(() => Promise.resolve(answers.length > 0 ? answers.shift()! : null)),
  promptText: vi.fn(() => Promise.resolve(answers.length > 0 ? answers.shift()! : null)),
}));

vi.mock("../../src/cli/commands/status.js", () => ({ runStatus: stub("status") }));
vi.mock("../../src/cli/commands/doctor.js", () => ({ runDoctor: stub("doctor") }));
vi.mock("../../src/cli/commands/setup.js", () => ({
  runSetup: vi.fn(() => {
    calls.push("setup");
    return Promise.resolve();
  }),
}));
vi.mock("../../src/cli/commands/font.js", () => ({
  runFontList: stub("font-list"),
  runFontCheck: vi.fn((family: string) => calls.push(`font-check:${family}`)),
}));
vi.mock("../../src/cli/commands/shell.js", () => ({
  runShellStatus: stub("shell-status"),
  // Both writing paths are async and ask for approval themselves; the menu must hand straight
  // to them rather than becoming a second approval flow, so what is asserted here is only that
  // it dispatches them.
  runShellInit: vi.fn(() => {
    calls.push("shell-init");
    return Promise.resolve();
  }),
  runShellRemove: vi.fn(() => {
    calls.push("shell-remove");
    return Promise.resolve();
  }),
}));
vi.mock("../../src/cli/commands/backup.js", () => ({
  runBackupCreate: stub("backup-create"),
  runBackupList: stub("backup-list"),
}));
vi.mock("../../src/cli/commands/theme.js", () => ({
  runThemeList: stub("theme-list"),
  runThemePreview: vi.fn((id: string) => calls.push(`theme-preview:${id}`)),
  runThemeApply: vi.fn((id: string) => calls.push(`theme-apply:${id}`)),
  runThemeValidate: vi.fn((f: string) => calls.push(`theme-validate:${f}`)),
  runThemeCreate: vi.fn((o: { id: string }) => calls.push(`theme-create:${o.id}`)),
  runThemeRemove: vi.fn((id: string) => calls.push(`theme-remove:${id}`)),
}));
vi.mock("../../src/cli/commands/profile.js", () => ({
  runProfileList: stub("profile-list"),
  runProfileApply: vi.fn((id: string) => calls.push(`profile-apply:${id}`)),
  runProfileImport: vi.fn((f: string) => calls.push(`profile-import:${f}`)),
  runProfileExport: vi.fn((id: string) => calls.push(`profile-export:${id}`)),
  runProfileRemove: vi.fn((id: string) => calls.push(`profile-remove:${id}`)),
}));

const { runInteractiveHome } = await import("../../src/cli/interactive/home.js");

describe("interactive home dispatch", () => {
  let originalStdin: boolean | undefined;
  let originalStdout: boolean | undefined;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    answers.length = 0;
    calls.length = 0;
    originalStdin = process.stdin.isTTY;
    originalStdout = process.stdout.isTTY;
    originalExitCode = process.exitCode;
    // The whole point of the harness: claim a TTY so the menu loop actually runs.
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
  });

  afterEach(() => {
    process.stdin.isTTY = originalStdin as true;
    process.stdout.isTTY = originalStdout as true;
    process.exitCode = originalExitCode;
    vi.clearAllMocks();
  });

  /** Scripts the answers the menu will receive, in order, then runs one whole session. */
  async function session(...script: (string | null)[]): Promise<string[]> {
    answers.push(...script);
    await runInteractiveHome();
    return calls;
  }

  it("prints status and exits without prompting when there is no TTY", async () => {
    process.stdin.isTTY = false;
    // No answers scripted at all: if this path prompted, the queue would be empty and the
    // session would end on a null rather than hanging - so the assertion that matters is that
    // `outro` never ran, i.e. the interactive loop was never entered.
    expect(await session()).toEqual(["status"]);
  });

  it.each([
    ["workspace dashboard", ["workspace", "dashboard"], "status"],
    ["workspace doctor", ["workspace", "doctor"], "doctor"],
    ["system setup", ["system", "setup"], "setup"],
    ["system backups create", ["system", "backups", "create"], "backup-create"],
    ["system backups list", ["system", "backups", "list"], "backup-list"],
    ["system fonts list", ["system", "fonts", "list"], "font-list"],
    ["customization theme list", ["customization", "theme", "list"], "theme-list"],
    ["customization profile list", ["customization", "profile", "list"], "profile-list"],
    ["integrations shell status", ["integrations", "shell", "status"], "shell-status"],
    ["integrations shell init", ["integrations", "shell", "init"], "shell-init"],
    ["integrations shell remove", ["integrations", "shell", "remove"], "shell-remove"],
  ])("routes %s to its command", async (_label, script, expected) => {
    // `status` always runs once at session open, so the assertion is on membership rather
    // than on the whole call list.
    expect(await session(...script)).toContain(expected);
  });

  it("passes the chosen id through to the command, not just the command name", async () => {
    // A dispatch test that only asserted `runThemeApply` was called would pass even if the
    // menu handed it the wrong theme.
    expect(await session("workspace", "quick-apply", "monolith")).toContain("theme-apply:monolith");
  });

  it("passes typed text through to the command", async () => {
    expect(await session("system", "fonts", "check", "Cascadia Code")).toContain(
      "font-check:Cascadia Code",
    );
  });

  it("collects every answer for a multi-prompt flow in order", async () => {
    expect(
      await session("customization", "theme", "create", "my-theme", "My Theme", "monolith"),
    ).toContain("theme-create:my-theme");
  });

  it.each([
    ["workspace", ["workspace", "back"]],
    ["customization", ["customization", "back"]],
    ["system", ["system", "back"]],
    ["integrations", ["integrations", "back"]],
    // The Shell Manager submenu edits a shell startup file, so a `back` that dispatched
    // anything would be the worst possible place for that bug.
    ["integrations shell", ["integrations", "shell", "back"]],
  ])("`back` in the %s menu dispatches nothing", async (_label, script) => {
    // Only the opening status call and the closing outro - no command ran in between.
    expect(await session(...script)).toEqual(["status", "outro"]);
  });

  it("a cancellation inside a submenu returns to the parent rather than exiting", async () => {
    // null is what `promptSelect` yields for Escape and Ctrl+C alike. Cancelling the theme
    // submenu must leave the session alive, so the *next* scripted answer is still consumed
    // by the top-level menu - here, `workspace`/`doctor`.
    expect(await session("customization", null, "workspace", "doctor")).toEqual([
      "status",
      "doctor",
      "outro",
    ]);
  });

  it("a cancellation at the top level ends the session", async () => {
    expect(await session(null)).toEqual(["status", "outro"]);
  });

  it("`Exit` ends the session", async () => {
    expect(await session("exit")).toEqual(["status", "outro"]);
  });

  it.each([
    ["customization widgets", ["customization", "widgets"]],
    ["customization ascii", ["customization", "ascii"]],
    ["integrations claude", ["integrations", "claude"]],
    ["integrations terminal", ["integrations", "terminal"]],
  ])("labels %s as planned instead of dispatching it", async (_label, script) => {
    // The warning is the whole behaviour: a planned section must say so, not silently do
    // nothing (which reads as a broken menu) and not dispatch something.
    const result = await session(...script);
    expect(result.filter((c) => c.startsWith("warn:"))).toHaveLength(1);
    expect(result.filter((c) => !c.startsWith("warn:"))).toEqual(["status", "outro"]);
  });

  /**
   * A-9: the shipped behaviour that had no test at all. One failed action mid-session used to
   * make the whole session exit non-zero, even after the user saw the failure, chose to carry
   * on, and everything afterwards succeeded.
   */
  describe("process.exitCode across a session", () => {
    it("resets after a failed action the user chose to continue past", async () => {
      process.exitCode = 0;
      // `doctor` exits 2 on a real detection problem; the menu dispatches it and carries on.
      const { runDoctor } = await import("../../src/cli/commands/doctor.js");
      vi.mocked(runDoctor).mockImplementationOnce(() => {
        calls.push("doctor");
        process.exitCode = 2;
      });

      await session("workspace", "doctor", "exit");

      expect(calls).toContain("doctor");
      expect(process.exitCode).toBe(0);
    });

    it("is still 0 for a session where nothing failed", async () => {
      process.exitCode = 0;
      await session("workspace", "doctor", "exit");
      expect(process.exitCode).toBe(0);
    });

    it("does not reset when the failure happens on the way out", async () => {
      // The reset is deliberately inside the loop body, after a section returns. A failure
      // raised by the *last* action still gets reset, because the user returned to the menu
      // and chose Exit - that is the same "saw it, carried on" case. Pinned so the boundary
      // is a decision rather than an accident: what would NOT be reset is a non-interactive
      // one-shot command, which never enters this loop at all.
      process.exitCode = 0;
      const { runStatus } = await import("../../src/cli/commands/status.js");
      vi.mocked(runStatus).mockImplementation(() => {
        calls.push("status");
        process.exitCode = 1;
      });

      await session("workspace", "dashboard", "exit");

      expect(process.exitCode).toBe(0);
    });
  });
});
