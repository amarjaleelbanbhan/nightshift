# NIGHTSHIFT — Agent Registry

Fourteen specialized agents, defined in `.claude/agents/`. Each has **exactly two** primary
tasks. Task IDs, dependencies, and acceptance criteria live in
`docs/development/IMPLEMENTATION_PLAN.md` §3.

**Dispatch note.** Claude Code loads `.claude/agents/*.md` at session start, so these
definitions became dispatchable only *after* the session that created them. During the cycle
that created them they were executed by `general-purpose` subagents instructed to read their
own definition file and operate under that identity. See `IMPLEMENTATION_PLAN.md` §2.

**Duplication check.** Each agent owns a distinct discipline. Deliberate overlaps are listed in
§3 below with the rule that resolves them, so expertise can be shared without two agents
redesigning the same component.

---

## 1. Registry

| Agent | Specialization | Primary tasks | Tools | Deliverables | Status |
|---|---|---|---|---|---|
| `planner-architect` | Planning, roadmap, orchestration, acceptance | **P1** assessment + roadmap · **P2** orchestration + final acceptance | R/W/E/Bash/Grep/Glob | `IMPLEMENTATION_PLAN.md`, `AGENT_REGISTRY.md`, `PROJECT_COMPLETION_REPORT.md` | P1 Done · P2 pending |
| `architecture-agent` | Module structure, layering, abstraction level | **A1** architecture audit · **A2** error-handling + exit-code contract, approved structural fixes | R/W/E/Bash/Grep/Glob | `ARCHITECTURE_AUDIT.md`, error module, updated `docs/ARCHITECTURE.md` | Not started |
| `core-cli-agent` | CLI engine, Commander wiring, command/option design | **C1** `nightshift setup` · **C2** `theme validate\|create\|remove` | R/W/E/Bash/Grep/Glob | New commands + wiring + menu integration | Not started |
| `feature-agent` | Domain feature engineering | **F1** feature inventory · **F2** font capability detection | R/W/E/Bash/Grep/Glob | `FEATURE_INVENTORY.md`, `src/core/fonts/`, `font list\|check` | Not started |
| `devex-ux-agent` | CLI UX, design system, accessibility, color | **X1** full CLI experience audit · **X2** `NO_COLOR` + contrast validation + error/empty/confirm components | R/W/E/Bash/Grep/Glob | `UX_AUDIT.md`, `src/cli/ui/*` components, contrast helper | Not started |
| `debugging-agent` | Root-cause diagnosis, edge-case failure hunting | **D1** reproducible bug hunt · **D2** fix verified defects + regression tests | R/W/E/Bash/Grep/Glob | `BUG_REPORT.md`, fixes, regression tests | Not started |
| `qa-testing-agent` | Test strategy, coverage, test implementation | **Q1** coverage audit + strategy · **Q2** implement missing tests + enable threshold | R/W/E/Bash/Grep/Glob | `TEST_STRATEGY.md`, coverage config, new tests | Not started |
| `code-review-agent` | Code quality, correctness, complexity review | **R1** baseline review · **R2** review this cycle's diff | R/Grep/Glob/Bash (**review-only**) | `CODE_REVIEW.md`, `CODE_REVIEW_CYCLE.md` | Not started |
| `security-agent` | AppSec: input validation, fs safety, dependency risk | **S1** security audit · **S2** Zod 4 upgrade + advisory remediation + hardening | R/W/E/Bash/Grep/Glob | `SECURITY_AUDIT.md`, dependency upgrades, updated `SECURITY-MODEL.md` | Not started |
| `performance-agent` | Startup latency, execution cost, measurement | **E1** measure and attribute cost · **E2** implement measured optimizations | R/W/E/Bash/Grep/Glob | `PERFORMANCE_REPORT.md`, lazy command loading | Not started |
| `dependency-compat-agent` | Dependencies, engines, lockfile, cross-platform | **N1** dependency/engine/compat audit · **N2** fix dependency management + verify compatibility | R/W/E/Bash/Grep/Glob | `DEPENDENCY_AUDIT.md`, corrected `engines`/`files`, lockfile health | Not started |
| `documentation-agent` | Technical documentation accuracy | **W1** docs truth audit · **W2** update docs to match reality | R/W/E/Bash/Grep/Glob | `DOCS_AUDIT.md`, `README.md`, `ROADMAP_STATUS.md`, `CHANGELOG.md` | Not started |
| `build-release-agent` | Build pipeline, packaging, CI, release readiness | **B1** build/packaging/release audit · **B2** improve + verify build and distribution | R/W/E/Bash/Grep/Glob | `BUILD_RELEASE_AUDIT.md`, CI workflow, `RELEASE_CHECKLIST.md` | Not started |
| `integration-agent` | Integration risk, collision resolution, combined validation | **I1** collision map from real diff · **I2** resolve + validate combined product | R/W/E/Bash/Grep/Glob | `INTEGRATION_REPORT.md`, resolved conflicts, exit-code table | Not started |

R/W/E = Read / Write / Edit.

## 2. Additional-agent evaluation

`planner-architect` evaluated the disciplines the prompt lists as candidates for extra agents.
Conclusion: **no additional agents**, because this is a single ~2,900-line TypeScript package
with no server, no database, and no network surface. Creating agents without real work for them
would inflate the team without improving the product.

| Candidate discipline | Verdict | Reason |
|---|---|---|
| API engineering | Not created | No HTTP/RPC surface exists. Phase 10 (Studio) would introduce one; create then. |
| Database engineering | Not created | No database. State is JSON files, owned by `core/config`. |
| Cross-platform testing | Not created | Folded into `dependency-compat-agent`. Linux/macOS **cannot be executed here**, so a dedicated agent could only produce unverified reasoning — the exact false confidence this project avoids. |
| Terminal rendering | Not created | Folded into `devex-ux-agent`, which already owns `src/cli/ui/` as sole rendering boundary. Splitting it would put two agents in one small module. |
| Accessibility | Not created | Folded into `devex-ux-agent` as task X2 (WCAG contrast validation). It is one concrete gap in one module, not a parallel workstream. |
| Developer tooling | Not created | Covered by `build-release-agent` (scripts, CI) and `dependency-compat-agent` (toolchain versions). |
| Observability | Not created | A one-shot CLI with no daemon has nothing to observe. Logging/telemetry is not in the product vision. |
| Package ecosystem compatibility | Not created | Owned by `dependency-compat-agent` (N1/N2) and verified by `build-release-agent`'s install-from-tarball test. |
| Migration engineering | Not created | One schema version (`"1.0"`) exists, and `config.json` already handles forward-compat via `.default(null)`. Revisit at a real `"2.0"`. |

## 3. Deliberate overlaps and the rule that resolves each

Specializations define expertise, not exclusive file locks — but a tie-breaker must exist or two
agents will solve the same problem twice.

| Overlap | Resolution rule |
|---|---|
| Error handling: `architecture-agent` (A2) vs `debugging-agent` (D2) | A2 defines the single strategy; D2 **uses** it. D2 does not add ad-hoc `try/catch` printing. |
| `src/index.ts`: `core-cli-agent`, `feature-agent`, `performance-agent` | Sequenced by wave. `performance-agent` (E2) edits it **last**, after the command set is final. |
| `package.json`: `security-agent`, `qa-testing-agent`, `dependency-compat-agent`, `build-release-agent` | Single writer per wave: Q1 (coverage dep) → S2 (version bumps) → N2 (`engines`/`files`) → B2 (scripts). |
| Validation logic: `devex-ux-agent` (contrast), `core-cli-agent` (`theme validate`), `security-agent` (Zod) | Zod owns schema validation; contrast is a separate pure helper owned by `devex-ux-agent`; `theme validate` **calls** both and implements neither. |
| `docs/ARCHITECTURE.md`: `architecture-agent` vs `documentation-agent` | `architecture-agent` writes it when structure changes; `documentation-agent` only flags drift. |
| `SECURITY.md` / `SECURITY-MODEL.md`: `security-agent` vs `documentation-agent` | `security-agent` writes; `documentation-agent` reviews for consistency with `README.md`. |
| Tests: `qa-testing-agent` vs `debugging-agent` | `debugging-agent` writes regression tests for bugs it fixed; `qa-testing-agent` owns coverage, strategy, and everything else. Duplicates are collapsed by `integration-agent`. |
| Audit reports vs implementation | Review-only tasks (R1, R2) never implement. Every other audit task (A1, S1, X1, D1, …) is explicitly paired with its own implementation task, so findings have an owner. |

## 4. Shared obligations

Every agent, regardless of specialization:

1. **Verify by running, never by reading.** A feature is not working because the code looks
   right. Paste real command output.
2. **Never fabricate** progress, test results, or coverage numbers.
3. **Isolate `APPDATA`** when exercising the CLI, so the developer's real config and Windows
   Terminal settings are never collateral damage.
4. **Never weaken, skip, or delete a test** to reach green. Report the conflict instead.
5. **Add no dependency** without `planner-architect`'s approval (one pre-approved exception:
   `@vitest/coverage-v8` for Q1).
6. **Preserve uncommitted work.** No `git reset --hard`, no `checkout --`, no `stash drop` —
   other agents' output lives in the working tree.
7. **No commit, tag, push, or publish** without explicit human authorization.
8. **Report honestly**, including what was not done and why. State clearly what remains
   **unverified** — especially anything needing a real interactive TTY.
