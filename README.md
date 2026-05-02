# Relit

Local-first toolkit for batch-relighting photos through a local ComfyUI instance.
Primary surface: a web app served by ComfyUI itself. Secondary: a headless CLI
sharing the same core, for scripted/unattended runs.

---

## Working agreement (read first, every session)

This is a real personal project I intend to use and extend. Quality > speed.

1. **Plan before coding.** For anything larger than a single-file change,
   produce a short plan (files touched, interfaces changed, tests added) and
   pause. Use your plan mode. Push back if the request is wrong, ambiguous,
   or under-specified — don't paper over it.
2. **Explore before assuming.** Before adding a dependency, check what's
   already installed. Before guessing the ComfyUI API shape, hit it from a
   scratch script and capture the real response into `docs/comfyui-api.md`.
3. **Keep decisions logged.** When you make a non-obvious choice
   (architecture, library, workaround), append a dated entry to
   `docs/decisions.md`: Decision / Rationale / Alternatives rejected.
   One paragraph each.
4. **Tests are not optional for `core`.** UI code can be lightly tested;
   anything in `packages/core` ships with Vitest unit tests. Integration
   tests that need a live ComfyUI are gated by an env flag.
5. **No silent failures.** Every error path either surfaces to the user with
   an actionable message or logs structured JSON with enough context to
   debug. Mirror the Sentry discipline.
6. **Ask, don't guess, on irreversible decisions.** Public API names, state
   library, persistence format — surface options with tradeoffs, let me pick.
   Internal naming, file layout, error wording — just decide.

---

## What this is

Folder of photos in → each photo passes through a configurable ComfyUI
workflow (default: IC-Light relight + DetailTransfer to preserve subject) →
folder of relit photos out. Subject must be preserved; only lighting changes.

ComfyUI runs locally at `http://localhost:8188`. The web app builds to a
static bundle and is copied into `~/ComfyUI/web/extensions/relit/` so it's
served same-origin by ComfyUI — no CORS, no second server, no auth.

---

## Architecture (shape is fixed, internals are yours to design)

pnpm monorepo:

```
packages/
  core/        # TS lib. Environment-agnostic. No DOM. No Node-only deps.
               # Owns: workflow patching, ComfyUI client, batch orchestration,
               # output naming. The contract every consumer uses.
  web/         # Vite app. Imports core. Static bundle.
  cli/         # Node CLI (commander). Imports core. tsx for dev, tsup for build.
workflows/     # ComfyUI API-format workflow JSON, version-controlled.
docs/
  decisions.md
  comfyui-api.md
```

The split exists because the web app is one consumer, the CLI is another,
and a future watch-folder daemon is a third. `core` is the contract.

### Core abstractions — define these first, then implement

- **`WorkflowDefinition`** — a workflow JSON + metadata declaring which
  nodes are input image / output image / user-tunable fields (seed, prompt,
  light direction, denoise). IC-Light is the first; Qwen-Image-Edit is the
  planned second. The abstraction must accommodate both without changes.
- **`ComfyClient`** — typed client over `/upload/image`, `/prompt`,
  `/history`, `/view`, `/ws`. Reconnecting WebSocket. Just the raw API,
  typed — no leaky abstractions on top.
- **`BatchRunner`** — orchestrates upload → patch workflow → submit → await →
  download. Emits typed events (`queued`/`started`/`progress`/`completed`/`failed`)
  per item. Consumers subscribe.
- **`FileSystem`** interface — abstracts file I/O so the same `BatchRunner`
  works against the File System Access API in the browser and `node:fs` in
  the CLI.
- **`OutputNamer`** — pure function: original filename + config → output
  path. Configurable suffix, collision strategy (skip/overwrite/number).

---

## Phased build — verify each phase before moving to the next

### Phase 0 — scaffolding

Monorepo, strict tsconfig (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ESLint, Prettier, Vitest, GitHub Actions CI
(typecheck + test on push).
**Done when:** `pnpm build`, `pnpm test`, `pnpm typecheck` all pass on a
clean clone.

### Phase 1 — ComfyClient + smoke test

Typed client. Integration test (gated by `RELIT_LIVE=1`) that round-trips
one tiny image through a trivial workflow against a real local ComfyUI.
**Done when:** types reflect actual API responses captured in
`docs/comfyui-api.md`; integration test passes locally.

### Phase 2 — WorkflowDefinition + IC-Light

Implement `WorkflowDefinition`. Add the IC-Light workflow JSON and its
definition file. `BatchRunner` runs one image end-to-end.
**Done when:** unit tests cover patching; integration test relights a
real image and writes it to disk.

### Phase 3 — CLI

`relit run --in ./photos --out ./relit --workflow iclight` with progress
bar, summary at end, non-zero exit on any failure (configurable).
**Done when:** I can batch a folder from the terminal.

### Phase 4 — Web app

Folder picker (FSA API), workflow dropdown, run button, per-image rows
with progress, before/after viewer. Same `BatchRunner` underneath. Build
script copies `dist` to `~/ComfyUI/web/extensions/relit/`.
**Done when:** the same job runs in the browser.

### Phase 5 — Polish

Workflow parameter editing in the UI (sliders for fields each
`WorkflowDefinition` declares user-tunable). Last-used settings in
localStorage. Failure summary export.

### Phase 6 — Second workflow (the real test of the abstraction)

Add Qwen-Image-Edit-2509 as a second `WorkflowDefinition`. If `core` had
to change to support it, the abstraction was wrong — fix it before
declaring this phase done.

---

## Conventions

- TypeScript strict. No `any` without an `eslint-disable-next-line` and a
  one-line justification.
- Errors are typed. Pick `Result<T, E>` or discriminated unions in Phase 0
  and stick to it.
- Logging: `pino` in CLI; `console` with structured payloads in browser.
  Every log carries a `correlationId` per batch.
- Conventional commits.

---

## When to ask vs. when to act

- **Act:** file structure, internal naming, test fixtures, error wording,
  anything inside a single function.
- **Ask:** adding a runtime dependency, changing a public API in `core`,
  picking a state-management library, choosing a persistence format,
  anything spanning packages.

---

## Out of scope (record, don't delete)

- Cloud / multi-user / auth.
- Editing the ComfyUI graph in-app — ComfyUI's own UI is the editor.
- Non-Chromium browsers (FSA API requirement).
- Generating workflows from natural language. Author in ComfyUI, export,
  drop into `workflows/`.
