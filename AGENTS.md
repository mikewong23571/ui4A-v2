# Repository Guidelines

## Read This First

UI4A is a pnpm/TypeScript monorepo implementing “interface as contract”: humans and agents operate the same Siren entities, actions, links, guards, and schemas. Read these before changing architecture:

1. `GOAL.md` — current product scope, completed T15–T20 story contracts, and invariants I1–I7.
2. `conductor/refs/arch-brief.md` — implementation-oriented architecture and terminology.
3. `DECISIONS.md` — binding technical decisions; record a new decision before deviating.
4. The active `conductor/tracks/<track>/spec.md` and `plan.md` for tracked feature work.
5. `apps/web/AGENTS.md` before editing the Next.js app; it contains version-specific rules.

## System and Application Map

There are three deployable workspace applications (`web`, `worker`, `cli`), six installed product Applications (`default`, `publishing`, `community`, `development`, `editorial`, `governance`), one shared event log, and four architectural planes:

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
- **Definition plane (`_meta`):** Flow definitions, Applications, Agent Definitions, Drafts, and Activations share a sitemap/Siren contract. The deterministic Meta Human Control Plane renders authorized governance; Application creation is not an in-product workflow.
- **Capability plane:** durable interaction with external systems. Temporal workflows coordinate work; activities perform I/O.
- **Presentation plane:** binding-only Recipe/Sidecar/Surface planning and A2UI hydration; it is a replayable sidecar, never business truth.

PostgreSQL is the source of truth. Current state, chat history, delegations, inbox entries, and UI entities are projections of the event log. Temporal owns durable execution history, not business truth. Never introduce a second authoritative state store.

## Workspace Module Responsibilities

### `apps/web` — UI, HTTP Contract, and Runtime Composition

- `src/app/`: Next.js pages and route handlers. Business contract endpoints are `/.well-known/ui4a.json`, `/api/entity`, `/api/exec`, `/api/exec-plan`, and `/api/events`. Canonical meta endpoints are `/_meta/.well-known/ui4a.json`, `/_meta/api/entity`, and `/_meta/api/exec`; `next.config.ts` rewrites them to internal handlers.
- `src/applications/`: installable application data. `ui4a-walkthrough.bundle.json` is the built-in application artifact; `bundles.ts` parses and registers bundles. Put application definitions here rather than hard-coding production flows into services.
- `src/engine/`: server-side composition boundary. `service.ts` connects the pure engine to PostgreSQL, Cedar, render specs, application bundles, and Temporal dispatch; event-log state, artifact materialization, confirmation decisions, sitemaps, and render-spec freezing live in `service-*.ts` modules. `flow-entry.ts` owns `flow:<name>` entry aliases. Agent Definition/dispatch modules sit in `src/engine/agent/`; Draft meta execution in `src/engine/drafts/`; service test suites in `src/engine/service-tests/`.
- Storage access lives in the shared `@ui4a/db` workspace package (`packages/db/src/`; T36 E1 抽包,web 与 worker 双端共同消费): PostgreSQL pool, schema, append/read operations, and replay tests. `events.ts` is the event-log write/read boundary; do not create a competing writer abstraction casually.
- `packages/db/src/drafts.ts`: Draft-domain events, immutable SHA-256 payloads, rebuildable projection, CAS, and transactional acceptance.
- `packages/db/src/agent-definitions/` (types/store/commands/queries/lifecycle) and `packages/db/src/agent-runs.ts`: append-only specialized definition/version registry and canonical Agent Run persistence; the Agent Run is the only run model.
- `src/engine/drafts/` (views/helpers/create/execute): Siren Draft/activation projection, validation/diff adapter, and human-only atomic Flow apply.
- `src/engine/agent/` (`agent-definitions.ts`, `native-agent-dispatch.ts`, `agent-definition-authoring.ts`, `coding-result-decision.ts`): activation registries, exact specialization task mapping, birth-pinned dispatch, and the result-to-Governed-Draft bridge. They must not accept Provider/profile overrides from requests.
- `src/domain/`: built-in domain helpers, predicates/flows used for bootstrap or testing, capability declarations, and Cedar policy loading. Production definition truth must still come from activated event-log artifacts.
- `src/render/`: deterministic A2UI compilation and hydration. `presentation/` compiles semantic Surface Trees; `deref.ts` and the entity cache resolve live facts; `canvas/` hosts surfaces; `words/` contains concrete vocabulary renderers.
- `src/engine/presentation/`: Presentation Broker, Application Recipe generation/registry, user-level Sidecar fastpath, dependency validation, and receipt production.
- `packages/db/src/presentation.ts`: replayable Presentation events and the rebuildable user Sidecar projection. It is separate from the Business fold.
- `src/chat/`: chat-session start, SSE streaming, history, trail, and decision projection. Chat is an event-log projection and an agent entry point, not an alternate command path.
- `src/temporal/`: web-side Temporal clients for notification, delegation, and canonical Agent Run dispatch/cancellation.
- `src/delegations/`: delegation-list projection helpers; read status from engine projections, not directly from Temporal.
- `src/components/`: React composition. `meta/` owns sitemap descriptors, the scope-aware client/cache, class renderer registry, generic fallback, Application/Agent Definition/Draft view models, and deterministic governance views; `assistant-ui/` adapts chat UI; `chat/` owns chat panel/session components and hooks; `ui/` holds local primitives. Meta routes must not restore a hardcoded surface inventory or render functional controls outside current Siren actions.
- `src/test/`: shared browser/jsdom stubs only. Keep feature tests next to their subjects.

### `apps/worker` — Durable Work and I/O

- `src/main.ts`: Temporal connection, task queue registration, process lifecycle, and graceful shutdown.
- `src/workflows.ts`: deterministic orchestration for notification, delegation, and canonical Agent Runs. Workflow code must not use Node APIs, fetch, random values, wall-clock reads, or database access.
- `src/activities.ts` + `src/activities/`: production transport assembly at the root file; specialization bindings (`agent-coding.ts`/`agent-writing.ts`/`agent-authoring.ts`) and shared deps in the subdir. Add a specialization as one binding; do not spread task-kind branches across Host lifecycle functions.
- `src/runtime-backends/`: Runtime Backend selection (`composition.ts`); Kubernetes backend in `kubernetes/`, trusted-host Runner in `host/`.
- `src/delegation.ts`: one durable agent step, HTTP contract calls, driver execution, sitemap loading, and delegation event recording.
- `src/capabilities/coding/`: provider adapters, repository registry, UI4A-owned Git worktrees, execution/result collection, and Temporal kill/cancel evidence. Provider code stays behind this boundary.
- `src/agents/host/`: generic lifecycle, suspension signals, restart boundaries, finalize protocol, and structured Codex transport. It must not contain business capability names or specialization semantics.
- `src/agents/coding/`: CodingTask/CodingResult adapter over the generic Host and Git workspace backend.
- `src/agents/writing/`: WritingBrief/WritingResult adapter, non-Git document workspace, immutable sources, citation, forbidden-effect, artifact, and Pandoc render verification.
- `src/agents/authoring/`: structured-only read-only runtime that drafts Agent Definitions, examples, and Eval cases. Invalid bounded candidates are results for Draft governance; only malformed envelopes fail before ingress.
- `src/banner.ts`: process messages only.

### `apps/cli` — External Agent Reference Client

- Owns the installable `ui4a` binary, config/redaction, stable JSON/error envelopes, bounded reads,
  business action adapters, Bundle export, Draft commands, audit, and GET/HEAD escape hatch.
- It consumes only HTTP/Siren/meta. It must not import `apps/web`, connect to PostgreSQL/Temporal,
  embed an LLM or business routing, expose approval, or accept identity/SubmissionPolicy overrides.

### `packages/shared` — Cross-Runtime Contracts

Owns state shapes, definition language types, guard contracts, predicate types, and constants shared by browser, server, worker, and engine, grouped into `definition/`, `agent/`, `presentation/`, and `deployment/` subdirs. It must remain platform-neutral and contain no database, Next.js, React, Temporal, or network code.

### `packages/engine` — Pure Business Kernel

Owns parsing and schemas; XState construction; declaration → guard → schema judgment; effects and execution; confirmation and plan execution; event folding; delegation state; Siren/sitemap projection; the pure Presentation kernel (`lens/surface/recipe/sidecar/patch`); definition lifecycle, bootstrap, diff, history, and activation invariants. Sources are grouped into `core/`, `contract/`, `execution/`, `projection/`, `definition/`, `delegation/`, `presentation/`, `agent-run/`, `capability-run/`, `agent-definition/`, and `submission/`; the `@ui4a/engine` barrel is the only public surface. Keep it deterministic and free of PostgreSQL, HTTP, React, Temporal, and environment access.

### `packages/agent` — Agent Protocol and Drivers

Owns the reusable agent loop, navigation/action matching, plan execution, thin Presentation requests, Presentation/Revision LLM adapters, HTTP adapter, projected tools, the production LLM driver, and model probing. Scripted/rule drivers are test fixtures only and must not re-enter product fallback paths. Drivers choose among contract-declared operations; they must not bypass `/api/entity`, `/api/exec`, or engine judgment.

Dependency direction is `shared ← engine ← agent`, with applications composing packages. `packages/db` is the platform storage package (may depend on `shared`/`engine`; must stay free of Next/React/Temporal). Do not import application code into packages; apps never import each other.

## Where a Change Belongs

| Change                               | Primary location                                 | Verification focus                               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| State/effect/judgment semantics      | `packages/engine/src/`                           | Pure unit and invariant tests                    |
| Shared definition or guard shape     | `packages/shared/src/`                           | Shared tests plus engine consumers               |
| Agent choice, tools, or LLM behavior | `packages/agent/src/`                            | Scripted/injected driver tests                   |
| Application flow/resource definition | `apps/web/src/applications/`                     | Bundle parsing, activation, sitemap, E2E         |
| HTTP status/body/contract            | `apps/web/src/app/api/`                          | Route and contract tests                         |
| Event persistence/replay             | `packages/db/src/`                               | DB integration, replay hash, concurrency         |
| Runtime orchestration/projection     | `apps/web/src/engine/`                           | Service and route tests                          |
| New render vocabulary                | `apps/web/src/render/words/` and `registry.ts`   | Word test, binding test, canvas E2E              |
| Meta UI                              | `apps/web/src/components/meta/`, `src/app/meta/` | Component test and meta E2E                      |
| Chat lifecycle                       | `apps/web/src/chat/`, chat routes/components     | SSE, history, recovery, browser E2E              |
| Presentation planning/cache          | engine presentation kernel + web adapters        | Binding-only, replay, invalidation, Golden Story |
| Durable capability/delegation        | `apps/worker/src/` plus web dispatch             | Determinism, idempotency, kill/retry integration |

Prefer extending a nearby pattern. When a change crosses rows, keep the pure contract/semantic change in a package and adapters at application boundaries.

## Governance Gates (T23, enforced by `pnpm check`)

Rules GR1–GR5 are mechanically enforced by `scripts/governance/`; run `pnpm governance` for the report.

- **GR1 dependency direction:** `packages/shared ← packages/engine ← packages/agent`; apps compose packages and never import each other. `shared`/`engine` stay free of platform packages (pg, Temporal, Next/React, Node http). Every exception must be registered in `scripts/governance/exceptions.json` with a reason and retirement condition _before_ the code is written; stale entries fail the gate.
- **GR2 no compatibility code while unreleased:** no legacy/compat dual paths for old wire formats, event shapes, or API behavior — change the single implementation; dev/test databases may be reset. Marker scans fail on unregistered legacy/compat wording.
- **GR3 size limits (effective lines):** non-test source file ≤ 500, test file ≤ 800, per-directory direct `.ts/.tsx` total ≤ 4000. Registered debt lives in `scripts/governance/size-baseline.json` (shrink-only; entries carry their owning track/plan, see the per-entry notes and DECISIONS.md D40/D52). New violations fail the gate.
- **GR4 gate semantics:** governance checks run in Red → Green → Gate order; baselines may only shrink; `governance:strict` (empty baselines) joins `pnpm check` only when the size baseline is fully cleared (DECISIONS.md D52; it is not tied to any single track closing).
- **GR5 archaeology control:** when a Track closes, its bespoke scripts/specs are either promoted to standing gates or deleted (git keeps history); do not add permanent per-track Playwright configs. Completed Tracks live read-only in `conductor/tracks/archive/`.

### D51 授权/注意力分离纪律(T33;执法主体=类型系统)

- **授权**:任何鉴权路径的输入只能是凭证的应用授予集合(`grantedApplications`)× 事实归属(fold 打标的 audience);禁止引入"当前会话 scope/活跃上下文"类输入。`resolveTrustedRequestIdentity` 不再产出被选择的 policyScope(`?scope=` 仅为导航偏好透传)。
- **注意力**:lens 只能出自 situation 单点装配(显式 > presence > 未定位),只消费于披露切片、常显位置与导航落点;不得进入任何鉴权签名。
- **失败语义**:授予内零可见授权事件;授予外与缺失为结构化 denied 回执;404 仅限跨 principal 存在性隐藏。
- 违反以上任一即架构回退;机制依据见 `DECISIONS.md` D51 与 `conductor/tracks/archive/t34-authority-attention-separation_20260827/architecture.md` §七 执法映射(D50 的 route 级 scopeCoverage 门禁已随该门禁退役)。

## Architectural Invariants

- **AI-first, mechanically governed:** the production Assistant uses the configured LLM and fails honestly when it is unavailable; deterministic code governs facts, authorization, actions, confirmation, audit, and replay. The human renderer remains available, but no rule driver impersonates Assistant intelligence.
- **Thin Presentation boundary:** Chat may send subject/intent/constraints/delivery and retain receipt references; full catalog, Surface, bindings, dependencies, or hydrated facts stay in the Presentation Plane.
- **User-level Sidecars:** durable Sidecar keys use principal/policy scope/subject/intent/device and never sessionId. Every hit reauthorizes and dereferences current facts.
- **Binding-only rendering:** model output contains references, never factual display values; renderers dereference the entity cache.
- **Action-backed interaction:** every functional control maps to a declared action and passes engine judgment.
- **No invented facts:** field values carry declared sources; work-product proposals require the selection gate.
- **Human-only approval:** `approve` rejects `actor=agent`; audit and mechanical-diff rendering use no AI.
- **Coding results are proposals:** Coding Agents write only an authorized UI4A-owned worktree. Result acceptance rechecks base/path/test/artifact integrity and records a human receipt; it never implies merge, push, deploy, or activation.
- **Server-owned executor selection:** application contracts name an executor class/profile requirement. Requests cannot choose provider, binary, model, cwd, sandbox, or unsafe mode; missing profiles fail before workspace mutation and never fall back.
- **Specialized definitions are proposals:** definitions are content-addressed, exact-version and birth-pinned. Agent-authored candidates enter T17 Drafts; only a human may activate them.
- **Meta UI is a projection, not a second authority:** discovery comes from the authorized Meta sitemap; renderer selection comes from Siren class; cross-plane links retain scope; every submit performs a fresh action read. Raw contract is audit-only, not the default human task path.
- Rejections are events with actionable reasons, not exceptional missing data.
- Every execution uses declaration → guard → schema order. Do not reorder or duplicate this judgment in UI code.
- Workflows orchestrate; activities perform I/O. Event writes and activities must tolerate retry/replay.

## Build, Test, and Development Commands

- `pnpm install` — install all workspaces.
- `pnpm dev:all` — start Docker PostgreSQL, Temporal dev server, worker, and web at `http://localhost:3100`.
- `pnpm infra:down` — stop PostgreSQL after local development.
- `pnpm --filter @ui4a/web build` — production Next.js build.
- `pnpm vitest run path/to/file.test.ts` — focused Vitest run.
- `pnpm vitest run --project db` / `--project unit` — run only the DB-touching (serial) or pure unit (parallel) project; `pnpm test` runs both via `test.projects` (unit project points `DATABASE_URL` at an unreachable address so misclassified DB tests fail loudly).
- `pnpm governance` — T23 governance gates (dependency direction, no-compat, size limits); default mode fails on new violations beyond the registered baselines, `pnpm governance:strict` additionally requires empty baselines.
- `pnpm check` — all workspace type checks, ESLint, governance gates, and Vitest tests.
- `CI=true pnpm e2e` — Playwright suite with a clean server and one CI worker.
- `CI=true pnpm e2e invariants` — focused invariant suite; use current GOAL for I1–I7 semantics.
- `pnpm format:check` / `pnpm format` — check or apply Prettier formatting.
- `pnpm cli:build` — build the CLI.
- `pnpm eval:llm` — opt-in real-LLM gate suite (provider profile via env; skips by default).

Vitest uses the isolated database at `localhost:5433/ui4a_test` unless `TEST_DATABASE_URL` overrides it. Do not point tests at the development database. Port 3100 is intentional; do not kill an unrelated service on port 3000.

## Coding, Testing, and Review Conventions

Use strict TypeScript, two-space indentation, single quotes, trailing commas, and 100-column formatting. ESLint treats unused variables as errors. Use `camelCase` for values/functions, `PascalCase` for types/components, and kebab-case filenames. Tests are colocated as `*.test.ts(x)`; Playwright files use `e2e/*.spec.ts`.

For tracked feature work, follow the active Conductor plan and TDD sequence. Test first at the narrowest pure boundary, then add contract/integration/E2E evidence only where behavior crosses boundaries. A green unit test is insufficient for changed HTTP, rendering, concurrency, replay, or user-flow contracts.

Use scoped, imperative Conventional Commit subjects, for example `fix(chat): persist in-flight turns` or `feat(agent): focus canvas`. Pull requests must state intent, affected planes/modules, relevant track, and exact verification commands. Include screenshots for UI changes and call out schema, dependency, environment, or architectural changes. Never commit `.env.local`, API keys, Temporal state files, database data, Playwright reports, or generated `.next*` output; document new variables in `.env.example`.
