# Architecture

Single TypeScript package, ESM, Node >=18. No monorepo, no backend, no database.

```text
src/
├── index.ts                     CLI entry (Commander wiring)
├── cli/
│   ├── version.ts               reads version from package.json at runtime
│   ├── commands/                one file per command group; pure-ish functions
│   │   └── *.ts                 that print to console and set process.exitCode
│   └── interactive/
│       └── home.ts              `nightshift` with no args — @inquirer/prompts menu
├── core/
│   ├── themes/                  schema (Zod), builtin themes, registry (builtin+user)
│   ├── profiles/                schema (Zod), registry (bundled+user)
│   ├── config/                  NIGHTSHIFT's own config.json: paths + read/write
│   └── capabilities/            platform/terminal/Claude Code detection
├── adapters/
│   └── windows-terminal/        locate settings.json, merge theme into it
├── backup/                      generic file-snapshot backup/restore
├── security/                    resolveSafePath, assertNotSymlink
├── utils/                       atomicWriteFileSync
└── banners/                     static startup banner
```

## Why this shape

- **Commands are thin wrappers over `core/`.** `src/cli/commands/theme.ts` holds the actual
  apply/verify/rollback logic (`applyThemeToWindowsTerminal`) as an exported function returning
  a plain result object; `runThemeApply` just prints it. This is what the interactive menu
  (`src/cli/interactive/home.ts`) and the Commander wiring (`src/index.ts`) both call — one
  implementation, two entry points. Profile apply (0.2.0+) follows the same pattern: it is
  *not* a second theme-application implementation, it resolves a profile to a theme and calls
  the existing function.
- **`backup/manager.ts` is generic**, not Windows-Terminal-specific: it snapshots any file path
  with metadata (reason, timestamp, original path) and restores by id. Any future adapter
  (Linux/macOS terminals, Claude Code settings) reuses it rather than reimplementing backup.
- **`security/paths.ts` is the only sanctioned way to turn a user-supplied string (theme id,
  backup id, import filename) into a filesystem path.** Every new file-system entry point
  (profile import/export, future marketplace installs) must route through
  `resolveSafePath`/`assertNotSymlink` rather than `path.join` directly.
- **Registries (`core/themes/registry.ts`, `core/profiles/registry.ts`) merge a builtin source
  and a user source and return a tagged `{ ..., source: "builtin" | "user" }` list.** This
  pattern is reused rather than re-invented for any future asset type (banners, widget packs).
- **No background process.** Every command is a one-shot `node` invocation. Widgets (planned)
  must compute on demand, not via a daemon.

## What's deliberately NOT abstracted yet

- There is one platform adapter (Windows Terminal). An `Adapter` interface is not introduced
  until a second real adapter exists — speculative interfaces for a single implementation
  are exactly the kind of premature abstraction this project avoids.
- There is no plugin/extension loader. Widget definitions, marketplace assets, and banners are
  data (JSON), not code, by design (see `docs/SECURITY-MODEL.md`).
