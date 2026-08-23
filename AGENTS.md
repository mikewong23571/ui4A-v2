# Repository Guidelines

## Read This First

UI4A is a pnpm/TypeScript monorepo implementing “interface as contract”: humans and agents operate the same Siren entities, actions, links, guards, and schemas. Read these before changing architecture:

1. `GOAL.md` — current product scope, T15/T16 story contracts, and invariants I1–I7.
2. `conductor/refs/arch-brief.md` — implementation-oriented architecture and terminology.
3. `DECISIONS.md` — binding technical decisions; record a new decision before deviating.
4. The active `conductor/tracks/<track>/spec.md` and `plan.md` for tracked feature work.
5. `apps/web/AGENTS.md` before editing the Next.js app; it contains version-specific rules.

## System and Application Map

There are three deployable applications, one shared event log, and three architectural planes:

```text
human UI / agent / script
          │ Siren + HTTP
          ▼
apps/web routes + service
   ├──► packages/engine (judge/effects/fold/project; pure)
   ├──► PostgreSQL append-only events (read/write)
   └──► Temporal ──► apps/worker workflows
                          └──► activities ──► web HTTP and/or event log

packages/shared ◄── packages/engine ◄── packages/agent
apps/cli ──HTTP/Siren/meta──► apps/web
```

- **Business plane:** application instances, flows, actions, and projections.
- **Definition plane (`_meta`):** Flow definitions are revised, validated, diffed, and activated through the same engine and log. Application creation is not an in-product workflow; a future external Agent may submit candidate bundles through meta contracts.
- **Capability plane:** durable interaction with external systems. Temporal workflows coordinate work; activities perform I/O.

PostgreSQL is the source of truth. Current state, chat history, delegations, inbox entries, and UI entities are projections of the event log. Temporal owns durable execution history, not business truth. Never introduce a second authoritative state store.

## Workspace Module Responsibilities

### `apps/web` — UI, HTTP Contract, and Runtime Composition

- `src/app/`: Next.js pages and route handlers. Business contract endpoints are `/.well-known/ui4a.json`, `/api/entity`, `/api/exec`, `/api/exec-plan`, and `/api/events`. Canonical meta endpoints are `/_meta/.well-known/ui4a.json`, `/_meta/api/entity`, and `/_meta/api/exec`; `next.config.ts` rewrites them to internal handlers.
- `src/applications/`: installable application data. `ui4a-walkthrough.bundle.json` is the built-in application artifact; `bundles.ts` parses and registers bundles. Put application definitions here rather than hard-coding production flows into services.
- `src/engine/`: server-side composition boundary. `service.ts` connects the pure engine to PostgreSQL, Cedar, render specs, application bundles, and Temporal dispatch. It serializes execution, incrementally folds new events, and serves business and meta projections. `flow-entry.ts` owns `flow:<name>` entry aliases and collection links.
- `src/db/`: PostgreSQL pool, schema, append/read operations, and replay tests. `events.ts` is the event-log write/read boundary. The worker currently reuses this adapter; do not create a competing writer abstraction casually.
- `src/db/drafts.ts`: Draft-domain events, immutable SHA-256 payloads, rebuildable projection, CAS, and transactional acceptance.
- `src/engine/drafts.ts`: Siren Draft/activation projection, validation/diff adapter, and human-only atomic Flow apply.
- `src/domain/`: built-in domain helpers, predicates/flows used for bootstrap or testing, capability declarations, and Cedar policy loading. Production definition truth must still come from activated event-log artifacts.
- `src/render/`: deterministic A2UI compilation and hydration. `presentation/` compiles semantic Surface Trees; `deref.ts` and the entity cache resolve live facts; `canvas/` hosts surfaces; `words/` contains concrete vocabulary renderers.
- `src/engine/presentation/`: Presentation Broker, Application Recipe generation/registry, user-level Sidecar fastpath, dependency validation, and receipt production.
- `src/db/presentation.ts`: replayable Presentation events and the rebuildable user Sidecar projection. It is separate from the Business fold.
- `src/chat/`: chat-session start, SSE streaming, history, trail, and decision projection. Chat is an event-log projection and an agent entry point, not an alternate command path.
- `src/temporal/`: web-side Temporal clients for notification and delegation dispatch.
- `src/delegations/`: delegation-list projection helpers; read status from engine projections, not directly from Temporal.
- `src/components/`: React composition. `meta/` contains definition-plane views; `assistant-ui/` adapts chat UI; `ui/` holds local primitives. Page components should orchestrate existing domain/render modules rather than absorb business rules.
- `src/test/`: shared browser/jsdom stubs only. Keep feature tests next to their subjects.

### `apps/worker` — Durable Work and I/O

- `src/main.ts`: Temporal connection, task queue registration, process lifecycle, and graceful shutdown.
- `src/workflows.ts`: deterministic workflow orchestration for notification and delegation. Workflow code must not use Node APIs, fetch, random values, wall-clock reads, or database access.
- `src/activities.ts`: I/O-capable activity registration and event-log writes; retries must be idempotent.
- `src/delegation.ts`: one durable agent step, HTTP contract calls, driver execution, sitemap loading, and delegation event recording.
- `src/banner.ts`: process messages only.

### `apps/cli` — External Agent Reference Client

- Owns the installable `ui4a` binary, config/redaction, stable JSON/error envelopes, bounded reads,
  business action adapters, Bundle export, Draft commands, audit, and GET/HEAD escape hatch.
- It consumes only HTTP/Siren/meta. It must not import `apps/web`, connect to PostgreSQL/Temporal,
  embed an LLM or business routing, expose approval, or accept identity/SubmissionPolicy overrides.

### `packages/shared` — Cross-Runtime Contracts

Owns state shapes, definition language types, guard contracts, predicate types, and constants shared by browser, server, worker, and engine. It must remain platform-neutral and contain no database, Next.js, React, Temporal, or network code.

### `packages/engine` — Pure Business Kernel

Owns parsing and schemas; XState construction; declaration → guard → schema judgment; effects and execution; confirmation and plan execution; event folding; delegation state; Siren/sitemap projection; the pure Presentation kernel (`lens/surface/recipe/sidecar/patch`); definition lifecycle, bootstrap, diff, history, and activation invariants. Keep it deterministic and free of PostgreSQL, HTTP, React, Temporal, and environment access.

### `packages/agent` — Agent Protocol and Drivers

Owns the reusable agent loop, navigation/action matching, plan execution, thin Presentation requests, Presentation/Revision LLM adapters, HTTP adapter, projected tools, the production LLM driver, and model probing. Scripted/rule drivers are test fixtures only and must not re-enter product fallback paths. Drivers choose among contract-declared operations; they must not bypass `/api/entity`, `/api/exec`, or engine judgment.

Dependency direction is `shared ← engine ← agent`, with applications composing packages. Do not import application code into packages. The existing worker-to-web DB adapter reuse is a known storage-boundary exception, not a general dependency pattern.

## Where a Change Belongs

| Change                               | Primary location                                 | Verification focus                               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| State/effect/judgment semantics      | `packages/engine/src/`                           | Pure unit and invariant tests                    |
| Shared definition or guard shape     | `packages/shared/src/`                           | Shared tests plus engine consumers               |
| Agent choice, tools, or LLM behavior | `packages/agent/src/`                            | Scripted/injected driver tests                   |
| Application flow/resource definition | `apps/web/src/applications/`                     | Bundle parsing, activation, sitemap, E2E         |
| HTTP status/body/contract            | `apps/web/src/app/api/`                          | Route and contract tests                         |
| Event persistence/replay             | `apps/web/src/db/`                               | DB integration, replay hash, concurrency         |
| Runtime orchestration/projection     | `apps/web/src/engine/`                           | Service and route tests                          |
| New render vocabulary                | `apps/web/src/render/words/` and `registry.ts`   | Word test, binding test, canvas E2E              |
| Meta UI                              | `apps/web/src/components/meta/`, `src/app/meta/` | Component test and meta E2E                      |
| Chat lifecycle                       | `apps/web/src/chat/`, chat routes/components     | SSE, history, recovery, browser E2E              |
| Presentation planning/cache          | engine presentation kernel + web adapters        | Binding-only, replay, invalidation, Golden Story |
| Durable capability/delegation        | `apps/worker/src/` plus web dispatch             | Determinism, idempotency, kill/retry integration |

Prefer extending a nearby pattern. When a change crosses rows, keep the pure contract/semantic change in a package and adapters at application boundaries.

## Architectural Invariants

- **AI-first, mechanically governed:** the production Assistant uses the configured LLM and fails honestly when it is unavailable; deterministic code governs facts, authorization, actions, confirmation, audit, and replay. The human renderer remains available, but no rule driver impersonates Assistant intelligence.
- **Thin Presentation boundary:** Chat may send subject/intent/constraints/delivery and retain receipt references; full catalog, Surface, bindings, dependencies, or hydrated facts stay in the Presentation Plane.
- **User-level Sidecars:** durable Sidecar keys use principal/policy scope/subject/intent/device and never sessionId. Every hit reauthorizes and dereferences current facts.
- **Binding-only rendering:** model output contains references, never factual display values; renderers dereference the entity cache.
- **Action-backed interaction:** every functional control maps to a declared action and passes engine judgment.
- **No invented facts:** field values carry declared sources; work-product proposals require the selection gate.
- **Human-only approval:** `approve` rejects `actor=agent`; audit and mechanical-diff rendering use no AI.
- Rejections are events with actionable reasons, not exceptional missing data.
- Every execution uses declaration → guard → schema order. Do not reorder or duplicate this judgment in UI code.
- Workflows orchestrate; activities perform I/O. Event writes and activities must tolerate retry/replay.

## Build, Test, and Development Commands

- `pnpm install` — install all workspaces.
- `pnpm dev:all` — start Docker PostgreSQL, Temporal dev server, worker, and web at `http://localhost:3100`.
- `pnpm infra:down` — stop PostgreSQL after local development.
- `pnpm --filter @ui4a/web build` — production Next.js build.
- `pnpm vitest run path/to/file.test.ts` — focused Vitest run.
- `pnpm check` — all workspace type checks, ESLint, and Vitest tests.
- `CI=true pnpm e2e` — Playwright suite with a clean server and one CI worker.
- `CI=true pnpm e2e invariants` — focused invariant suite; use current GOAL for I1–I7 semantics.
- `pnpm format:check` / `pnpm format` — check or apply Prettier formatting.
- `pnpm cli:build` / `pnpm eval:t17` — build the CLI and run T17 protocol/safety evidence.

Vitest uses the isolated database at `localhost:5433/ui4a_test` unless `TEST_DATABASE_URL` overrides it. Do not point tests at the development database. Port 3100 is intentional; do not kill an unrelated service on port 3000.

## Coding, Testing, and Review Conventions

Use strict TypeScript, two-space indentation, single quotes, trailing commas, and 100-column formatting. ESLint treats unused variables as errors. Use `camelCase` for values/functions, `PascalCase` for types/components, and kebab-case filenames. Tests are colocated as `*.test.ts(x)`; Playwright files use `e2e/*.spec.ts`.

For tracked feature work, follow the active Conductor plan and TDD sequence. Test first at the narrowest pure boundary, then add contract/integration/E2E evidence only where behavior crosses boundaries. A green unit test is insufficient for changed HTTP, rendering, concurrency, replay, or user-flow contracts.

Use scoped, imperative Conventional Commit subjects, for example `fix(chat): persist in-flight turns` or `feat(agent): focus canvas`. Pull requests must state intent, affected planes/modules, relevant track, and exact verification commands. Include screenshots for UI changes and call out schema, dependency, environment, or architectural changes. Never commit `.env.local`, API keys, Temporal state files, database data, Playwright reports, or generated `.next*` output; document new variables in `.env.example`.
