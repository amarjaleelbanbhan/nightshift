# Contributing to NIGHTSHIFT

## Setup

```bash
npm install
npm run dev -- --help   # run the CLI from source via tsx
```

## Before opening a PR

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

All four must pass.

## Guidelines

- Keep the dependency tree small. Check whether Node.js, an already-installed dependency, or
  a few lines of code already solves the problem before adding a package.
- Every configuration-mutating code path must back up the target file first and verify the
  result afterward (see `src/backup/manager.ts` and `src/cli/commands/theme.ts`).
- Any code that reads a file path derived from user or marketplace input must go through
  `resolveSafePath` (`src/security/paths.ts`).
- Don't advertise a feature as implemented in the CLI help text, README, or interactive menu
  unless it actually works end to end.
- New platform adapters or terminal integrations should report `supported` / `partial` /
  `unsupported` / `unknown` based on real detection, not assumption.

## Project layout

See `README.md` for the current module layout and what each part owns.
