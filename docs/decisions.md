# Decisions

Append-only log. Newest entries at the top. One paragraph per section:
**Decision** / **Rationale** / **Alternatives rejected**.

---

## 2026-05-03 — Web app: vanilla DOM, no framework

**Decision.** Render the web UI with a tiny `h()` helper over plain DOM
nodes. No React/Preact/Solid. Param form is generated from each
`WorkflowDefinition`'s `ParamSpec` map.

**Rationale.** The UI is small (sidebar + table + viewer), state is shallow,
and the bundle ships inside `~/ComfyUI/web/extensions/relit/` where bundle
size matters. Vanilla DOM keeps the dist around 30 KB total and avoids
locking the user into a runtime they may not want.

**Alternatives rejected.** Preact (would still ship its runtime, marginal
ergonomic win over `h()`); React (heaviest, no upside here); Solid (small,
but signal model is overkill for a per-batch-rerender app).

## 2026-05-03 — One built-in passthrough workflow + skeletons for IC-Light & Qwen

**Decision.** Ship `passthroughWorkflow` (LoadImage→SaveImage) as the
always-runnable default, plus `iclightWorkflow` and `qwenImageEditWorkflow`
as definitions whose JSONs require specific custom nodes / model files.

**Rationale.** README rule 2 ("explore before assuming") wins: the local
ComfyUI doesn't have IC-Light installed, so I can't ship a pre-tested
IC-Light JSON without speculating. Passthrough proves the runner end-to-end
on any vanilla ComfyUI; IC-Light/Qwen become real once the user installs
the named custom-node packs (the README itself says the user authors
workflow JSON in ComfyUI and drops it into `workflows/`).

**Alternatives rejected.** Auto-generating workflow JSON from natural
language (explicitly out of scope per README); shipping IC-Light without
verifying it runs (would mask Phase 1's smoke-test discipline).

## 2026-05-03 — Phase 6 abstraction holds

**Decision.** `WorkflowDefinition` did not need to grow to support
`qwenImageEditWorkflow`. The Qwen graph uses different node types
(`UNETLoader`, `CLIPLoader`, `TextEncodeQwenImageEditPlus`,
`EmptyQwenImageLayeredLatentImage`) but every binding fits the existing
`NodeInputBinding = { node, input }` shape, and every param fits the
existing `ParamSpec` kinds. A test in `workflows.test.ts` locks the kind
set at `{integer, number, seed, string}` so growing the param surface for
a future workflow becomes a deliberate change.

**Rationale.** Per the README's Phase 6 framing, this was the test of the
abstraction. If `core` had to change, the abstraction was wrong — it didn't.

**Alternatives considered.** Adding a `path` field to `NodeInputBinding`
for nested-input nodes: not needed yet, deferred. Adding `range` /
`vector` ParamSpecs: not needed for IC-Light or Qwen, deferred.

## 2026-05-03 — Runtime deps in the CLI

**Decision.** CLI takes runtime deps on `commander` (arg parsing), `kleur`
(terminal colors), `pino` + `pino-pretty` (structured logs).

**Rationale.** Per README rule 6, "adding a runtime dependency" is an ask
moment. I'm noting these here because the user authorised "max freedom" for
this build. Each is a one-line replace cost (`commander` ↔ stdlib
`util.parseArgs`; `kleur` ↔ raw ANSI; `pino` ↔ console). They're documented
here so the swap is easy if any of them sour.

**Alternatives rejected.** `yargs` (heavier, sync default model fights the
async run command); `chalk` (kleur is leaner and has the same API);
`winston` (heavier than pino).

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
