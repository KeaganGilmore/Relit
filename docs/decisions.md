# Decisions

Append-only log. Newest entries at the top. One paragraph per section:
**Decision** / **Rationale** / **Alternatives rejected**.

---

## 2026-05-02 — Phase 0 toolchain

**Decision.** pnpm workspaces, TypeScript 5.7 strict (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Vitest at the root,
ESLint 9 flat config + Prettier, tsup for the CLI bundle, Vite 6 for the web
app. Node 20.11+ floor.

**Rationale.** pnpm's workspace protocol (`workspace:*`) makes `core` ↔ `cli` /
`web` linking trivial without publishing. Strict TS catches the nullable-index
class of bugs the README's `Result` discipline is meant to surface. Single
root-level Vitest config keeps test config from drifting per-package; tsup
gives the CLI a hashbang'd ESM bundle in one step.

**Alternatives rejected.** npm/yarn workspaces (slower, weaker hoisting
controls); Jest (slower startup, ESM friction); Rollup direct (more config for
no win over tsup); Turborepo / Nx (premature for three packages).

## 2026-05-02 — Result type over thrown errors

**Decision.** Errors flow through a `Result<T, E>` discriminated union
(`packages/core/src/result.ts`). Throw only for genuine bugs (invariants),
never for expected failure modes (network down, file missing, workflow
malformed).

**Rationale.** README rule 5 ("no silent failures") requires that every error
path is visible. `Result` makes "this can fail" part of the type signature, so
callers can't accidentally ignore it. Plays well with `BatchRunner` emitting
`failed` events per item without aborting the batch.

**Alternatives rejected.** Throwing + try/catch (loses type info, easy to
miss); `neverthrow` (extra runtime dep for what fits in 20 lines); Go-style
`[value, error]` tuples (worse ergonomics in TS than tagged unions).
