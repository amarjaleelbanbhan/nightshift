# Real-TTY release checklist

Gate for `docs/development/RELEASE_CHECKLIST.md` §3a. **A human runs this in Windows Terminal,
on the built artifact, before a release.**

## Why this file exists

`@clack/prompts` will not render without a real TTY, so no CI job can exercise the interactive
experience. That gap was not theoretical — two shipped defects were invisible in piped output
and only ever appeared in a real terminal:

- every table overflowed the terminal width by exactly +2 at every width (120 → 122, 80 → 82,
  60 → 62), because piped output has no width for the calculation to get wrong;
- `NO_COLOR` did nothing at all, and the obvious test passed anyway, because piped output is
  already ANSI-free. It took `FORCE_COLOR=3` to expose it.

So the split is deliberate (issue #13): **dispatch is automated, rendering is human.**

## What is already automated — do not re-check by hand

`tests/unit/interactive-home.test.ts` drives the menu loop headlessly with a scripted answer
queue and covers: which command each menu path dispatches, that the chosen id and typed text
reach the command, that `back` and a cancellation return to the parent without dispatching,
that a cancellation at the top level ends the session, that planned sections warn rather than
dispatch, and the `process.exitCode` reset after a failed action the user continued past (A-9).
Verified meaningful by mutation — breaking the `doctor` route, the cancel-returns-to-parent
behaviour, and the exit-code reset each fail it.

`tests/integration/no-color.test.ts` and `tests/unit/table-width.test.ts` cover the two defects
above mechanically, under `FORCE_COLOR=3` and at explicit widths.

What remains below is the part no harness can answer: whether it looks right.

## 1. Interactive flow — `nightshift` with no arguments

- [ ] The clack `intro` / `select` / `outro` left-bar style renders as intended, with no
      doubled or broken box characters.
- [ ] Arrow-key navigation works through Workspace / Customization / Integrations / System.
- [ ] **Escape**, then **Ctrl+C**, at a submenu and at the top level. Neither orphans the
      terminal: cursor visible, echo working, no stray ANSI left on the line. (Dispatch is
      tested; terminal-state restoration is clack's and can only be seen.)
- [ ] boxen panels and clack boxes never appear on the same screen — the two-border-language
      rule in `docs/ARCHITECTURE.md`.
- [ ] A long session stays legible: run six or seven actions in a row and confirm the scrollback
      does not become unreadable.
- [ ] **Theme Studio → Edit a theme.** The role list is 25 entries long, so it scrolls: confirm
      the current hex hint stays aligned beside each role, and that the list is navigable rather
      than merely present. Which pair the chosen role and value become is tested headlessly; how
      a 25-item `select` reads in 40 columns is not.

## 2. Colour and contrast in a real terminal

- [ ] `NO_COLOR=1 nightshift status` — confirm the real session matches the mechanical proof.
- [ ] `nightshift theme preview <id>` **with acrylic/transparency enabled.** The measured
      contrast ratios assume an opaque background and are optimistic when transparency is on.
- [ ] `redline`'s 4.98:1 primary at 14pt — the closest built-in pair to the AA floor. Judge
      whether it is comfortable, not just whether it passes.

## 3. Terminal geometry

- [ ] Resize the window to roughly **40 columns**, then re-run `status`, `doctor`, `theme list`,
      `backup list`, `font list`. In a real TTY `process.stdout.columns` is defined, so this
      exercises a path reachable in CI only by direct function call.
- [ ] No table wraps or overflows at the default width. This is the +2 defect's home.

## 4. Write-surface commands

These modify the real `settings.json`, so no automated suite runs them against a live
installation. **Take a backup first** (`nightshift backup create`).

- [ ] `nightshift theme apply <id> --dry-run` — the preview names the real resolved path and the
      keys it would touch.
- [ ] `nightshift theme apply <id>` — success output, backup id reported, and Windows Terminal
      actually picks up the colours.
- [ ] Re-run the same apply — the file is byte-identical and `--dry-run` says "would change
      nothing".
- [ ] If your `settings.json` has comments, confirm they are still there afterwards (#14).
- [ ] `nightshift profile apply <id>` — same checks.
- [ ] `nightshift backup restore <id>` — it prints the destination *before* writing, and the
      restore lands.

## Recording the result

Note the date, the NIGHTSHIFT version, and the Windows Terminal version in the release PR.
An unchecked box is a blocker, not a note. If an item cannot be checked (no transparency set up,
for example), say so explicitly rather than ticking it — the whole point of this file is that
unverified things are not claimed as verified.
