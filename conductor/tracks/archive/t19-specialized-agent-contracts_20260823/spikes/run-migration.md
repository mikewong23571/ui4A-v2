# T19 Run Migration Spike

## Question and baseline

This spike decides how T19 can introduce a generic `agent-run:<id>` without rewriting or duplicating the
T18 Coding Capability truth. It is read-only analysis at repository revision `5312aeb`; no database or
runtime probe was required because the uncertainty is the current wire/storage coupling, which is fully
visible in source.

The current T18 Run is only nominally generic. A production-source scan found 23 files and 323 matching
references for `coding|Coding|capability-run|capability_run` across Shared, Engine, Web, and Worker. The
narrower Run-shape scan found 16 production files. The concentration is useful: persistence and lifecycle
are reusable, while task/workspace/result/verifier and dispatch are coding-specific.

Inspection commands:

```bash
git rev-parse --short HEAD

rg -n --glob '!conductor/**' --glob '!.zcode/**' --glob '!node_modules/**' \
  'CapabilityRun|CodingTask|CodingResult|coding\.execute|capability-run|capability_run|codingCapability' \
  packages apps scripts e2e

for root in packages/shared packages/engine apps/web apps/worker; do
  rg -l --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' \
    'coding|Coding|capability-run|capability_run' "$root"
done

rg -n 'accept-capability-result|reject-capability-result|capability-callback' packages apps
```

## Coupling inventory

### Shared contract

- `packages/shared/src/coding-executor.ts` defines `CodingTask`, Git-shaped `WorkspaceHandle`,
  `CodingRunHandle`, normalized events, `CodingResult`, budgets, redaction, descriptors, and deployment
  profiles. This is a valid **Coding specialization contract**, not a generic Host contract.
- `packages/shared/src/definition.ts:166-169` embeds the old callback marker and Coding-result decision
  vocabulary in every `ActionDefinition`. These values must remain parseable for T18, but new generic
  proposal handling should not add more specialization names to this union.
- `packages/shared/src/index.ts:25-26` exports the Coding contract directly. It can remain as a compatibility
  and specialization export after generic Agent envelopes are added alongside it.

### Pure Engine

- `packages/engine/src/parse.ts:135-149` parses only the legacy callback and Coding-result decision literals.
  The parser must retain those literals for old Bundles while a generic proposal contract is added separately.
- `packages/engine/src/capability-run/run.ts:1-138` types the aggregate and every create/start/succeed event
  with `CodingTask`, Git `WorkspaceHandle`, `CodingRunHandle`, and `CodingResult`. Lines 212-216 enforce
  repository/base matching in the lifecycle itself. Lifecycle, cursor, restart, CAS, and idempotency are
  reusable; repository/base validation belongs in the Coding adapter/verifier.
- `packages/engine/src/capability-run/profile.ts` aliases generic-looking profile types to
  `CodingExecutorProfile`/`CodingExecutorDescriptor`. Its no-fallback resolver is reusable after the port
  types move to a generic Runtime contract.
- `packages/engine/src/capability-run/workspace-policy.ts` and
  `packages/engine/src/capability-run/result-decision.ts` are intentionally Git/Coding-specific. They should
  move behind the Coding specialization, not be generalized into weak optional fields.
- `packages/engine/src/index.ts:32-33` exposes the old aggregate as the Run plane. Existing imports must keep
  working through compatibility exports while new code imports `agent-run`.

### Web persistence and HTTP composition

- `apps/web/src/db/capability-runs.ts` is the durable boundary: legacy event kinds
  `capability-run-*`, rels `capability-run:<id>`, tables `capability_payloads` and
  `capability_run_projection`, command/event uniqueness, raw/result CAS payloads, replay, and
  owner/`policyScope` queries. The log in `domain='capability'` is authoritative; the table is explicitly
  rebuildable. Raw budgets currently read `aggregate.task.budget`, and normalized event types are Coding.
- `apps/web/src/db/events.ts:60-72` fixes the old event-family names in the public storage type. Removing or
  rewriting them would make archived T18 logs unreadable.
- `apps/web/src/engine/capability-runs.ts` combines four concerns: task mapping and runtime preflight
  (lines 40-125), Run creation/Temporal dispatch (105-170), Siren compatibility resources
  (173-310), and Git result acceptance (313-408). The Siren entity hard-codes `coding.execute` and Coding
  fields at lines 184-195.
- `apps/web/src/engine/service.ts:741-810` preflights every spawn through a Coding profile and dispatches only
  when `executor.class === 'coding-agent'`. This is the principal Host-level coding branch T19 must remove.
  The same service preserves the source `spawn-requested` sequence and declared `on-done/on-error`, so it is
  also the idempotent Capability-to-Run bridge that must not be bypassed.
- `apps/web/src/engine/capability-source-callback.ts` looks up the Run internally, re-enters the declared
  source action as `system:capability:<runId>`, and deduplicates an already-terminal source Flow. This logic is
  Run-generic except for Coding terminal node names and `resultId` callback params.
- `apps/web/src/app/api/entity/route.ts` and `apps/web/src/app/api/exec/route.ts` special-case legacy
  `capability-runs`/`capability-run:<id>` reads and cancel. These routes are observable T18 API and should
  become thin compatibility presenters, not be deleted.
- `apps/web/src/temporal/capability.ts` fixes workflow type `codingCapabilityWorkflow` and workflow ID
  `coding-<runId>`. In-flight workflow histories require this export and identifier to remain deployable.
- `apps/web/src/engine/coding-executor-config.ts`, `apps/web/src/engine/drafts.ts`, and activation invariant
  wiring resolve only `UI4A_CODING_EXECUTOR_PROFILES`. T19 needs a generic Runtime registry, while the old
  variable remains an input adapter during migration.
- `apps/web/src/applications/ui4a-walkthrough.bundle.json` is a legitimate T18 consumer:
  `coding.execute`, Coding input schema, source callbacks, and accept/reject actions should retain their
  current behavior while the capability gains an `agentDefinition` reference.

### Worker and Temporal

- `apps/worker/src/workflows.ts:59-128` defines a Coding-only prepare/execute/finalize workflow. Its segmented
  orchestration and retry policy are generic, but args/results/activity names are Coding and lack definition,
  prompt, task-schema, result-schema, and runtime birth refs.
- `apps/worker/src/activities.ts:123-176` reads Coding-only environment registries, calls Coding runtime
  functions, and posts the old callback route. These remain a legacy activity facade while the implementation
  delegates to generic Host ports.
- `apps/worker/src/capabilities/coding/runtime.ts` imports Web persistence directly and mixes reusable event
  persistence/heartbeat/restart with Codex, Git workspace collection, test claim reconciliation, and Coding
  result construction. The latter pieces remain in `agents/coding`; generic Run commands must be injected as a
  Host port.
- `apps/worker/src/capabilities/coding/codex.ts`, `workspace.ts`, and `compatibility.ts` are proper
  specialization/provider adapters and should not be pushed into the generic Host.

Tests and evidence coupled to the old wire contract include
`packages/engine/src/capability-run/*.test.ts`, `apps/web/src/db/capability-runs.test.ts`,
`apps/web/src/engine/capability-runs.test.ts`, `apps/web/src/temporal/capability.test.ts`,
`apps/worker/src/capabilities/coding/{runtime,temporal.integration,codex,workspace}.test.ts`,
`apps/worker/src/capabilities/coding/temporal-test-worker.fixture.ts`,
`e2e/t18-coding-capability.spec.ts`, and `scripts/t18-real-eval.ts`. They are regression assets, not migration
debt, and must continue to pass unchanged or through an explicit test-only compatibility fixture.

## Alternatives

| Option | Single durable truth | T18 wire/API/history | Generic birth refs | Rewrite risk | Decision |
| --- | --- | --- | --- | --- | --- |
| A. Mutate `capability-run` in place | Yes | Superficially easiest, but changes payload meaning under the same event names | Requires optional/version-switched fields inside the old aggregate | Medium-high; generic and legacy semantics become one growing union | Reject |
| B. Generic `agent-run` plus legacy codec/presenter | Yes: one append-only log and one canonical Agent Run projection | Old events are upcast read-only; old rels/routes/workflow export remain adapters | Native on new events; deterministic, explicitly synthetic legacy birth descriptor on old events | Lowest staged risk; no live rewrite | **Adopt** |
| C. New event family with copied runtime | No practical unity: two kernels, projections, callback paths, and recovery implementations | Preserved by isolation | Native only for new family | Low initial diff, permanent dual behavior and later big bang | Reject |

### Why not A

The name is not the main problem. The old create/start/succeed payloads have mandatory Coding DTOs and enforce
repository/base semantics inside the fold. Making those properties optional or adding `schemaVersion: 2` to
the same `capability-run-created` family leaves every generic consumer responsible for old-vs-new branching.
It also encourages `CapabilityDefinition` and execution identity to remain conflated. A compatibility codec is
needed anyway; isolating it at ingress gives the new kernel one truthful shape.

### Why not C

Copying the proven runtime would protect T18 locally but create two authorities for source linkage, cancellation,
raw budgets, callback idempotency, and result decisions. The first Writing story would pass while Coding and
Writing evolved on different lifecycle semantics. That fails T19's shared Host requirement and merely postpones
the migration.

## Recommendation: one Agent Run truth, two wire generations

Adopt B with this precise boundary:

```text
legacy capability-run-* events ── legacyEventCodec ──┐
                                                     ├─► AgentRun fold
new agent-run-* events ────────── native codec ──────┘       │
                                                             ▼
                                                   agent_run_projection
                                                     │            │
                                           canonical Agent API   T18 presenter
                                           agent-run:<id>         capability-run:<id>
```

The append-only `events` table remains the only durable Run truth. New Runs write only `agent-run-*` lifecycle
events. Existing `capability-run-*` events are never updated, copied, or supplemented with backfill events.
`agent_run_projection` is rebuilt from the union through an explicit versioned decoder. The legacy
`capability_run_projection` must not remain a second independently updated projection: in the migration release
it may exist long enough for rollback, but reads switch to the canonical projection and it is then replaced by a
view or removed by a separately reviewed migration.

For old T18 create events, the decoder attaches a constant compatibility birth descriptor:

```text
definitionRef = coding-agent@1
birthKind = legacy-t18-synthesized
definitionHash = fixed hash of the shipped immutable coding-agent@1 legacy definition
promptHash = hash of the exact historical prompt compiler output for the recorded CodingTask
runtimeRef = legacy profileName + adapter version t18-v1
```

This metadata is deterministic and clearly marked as reconstructed; it must never claim that T18 logged fields
which did not exist. The compatibility constant and compiler are versioned source inputs to replay. New Runs
record all birth refs and hashes directly in `agent-run-created`.

## Migration sequence

1. **Freeze legacy fixtures.** Commit representative T18 event JSON for queued, running/restarted, succeeded,
   failed, cancelled, raw, normalized, and source-callback histories. Record current Siren/API JSON and workflow
   IDs. No production shape changes yet.
2. **Introduce generic contracts/kernel.** Add provider-neutral `AgentTaskEnvelope`, `AgentResultEnvelope`,
   birth refs, questions/grants, and `AgentRun` fold. Generic code must contain no Coding/Git/Provider terms.
3. **Add the legacy decoder.** Decode `capability-run-*` into the canonical aggregate and map Coding DTOs into
   specialization payloads without altering their JSON. Unknown legacy/new schema versions fail closed.
4. **Create the canonical projection.** Build `agent_run_projection` entirely from old and new events; retain
   principal/`policyScope`/source/status indexes. Add a cross-family unique creation key for
   `source.eventId` so one `spawn-requested` cannot create both a legacy and native Run.
5. **Move Web reads first.** Serve the old `capability-runs` and `capability-run:<id>` representations from the
   canonical projection through `coding-agent@1` adapters. Exact legacy response/action/link assertions must be
   green before any write-path switch.
6. **Introduce the generic dispatch path.** Resolve Capability → exact `AgentDefinition@version` → exact
   Runtime Profile before appending the source outcome. Write a native `agent-run-created` with all birth refs.
   Route by definition/runtime registry, never by `coding.execute` or `coding-agent` string branches.
7. **Adapt Coding specialization.** Keep Coding task mapping, Git workspace, Codex adapter, verifier, and human
   decision as ports selected by the activated definition. Re-run all T18 deterministic and real corpora.
8. **Preserve Temporal history.** Keep `codingCapabilityWorkflow`, `coding-<runId>`, and old activity names for
   in-flight T18 histories; their activities call the compatibility command port. New Runs use
   `agentRunWorkflow`/`agent-<runId>`. Never change a live workflow type or ID in place.
9. **Unify callbacks/cancellation.** Both callback routes resolve the canonical Run and then dispatch the
   source's recorded action. Cancellation selects the workflow identifier from persisted Run origin, not from
   specialization name. Result adaptation supplies the existing Coding `runId/resultId` callback unchanged.
10. **Retire duplicate projection code only after evidence.** Rebuild from an empty projection, compare hashes,
    drain/replay old Temporal histories, and prove old HTTP snapshots. Removal of the old table/export is a later
    compatibility decision; deletion is not required to complete T19.

This sequence supports rolling implementation and rollback. At no point does one source event dispatch both
workflows, and at no point is a Run copied into a second event family.

## Compatibility invariants

1. `domain='capability'` and all existing `capability-run-*`, raw, and normalized event JSON remain readable
   byte-for-byte; no UPDATE/DELETE/backfill is required.
2. Full replay and incremental replay of the same mixed event stream produce the same canonical aggregate and
   projection hash.
3. Every Run has exactly one creation source event, one event family of birth, one terminal result/failure, and
   at most one terminal source callback.
4. `principal` plus `policyScope` filters apply before exact/list/raw/result payload disclosure for both API
   generations; internal lookup remains limited to the authenticated callback bridge.
5. `source.rel`, `source.action`, `source.eventId`, and declared `onDoneAction/onErrorAction` survive decoding
   unchanged. Result callbacks re-enter the normal engine guard/schema path.
6. Old `capability-runs`, `capability-run:<id>`, cancel action, link relations, Coding properties, and HTTP status
   behavior remain stable for legacy and migrated Coding Runs.
7. Old `codingCapabilityWorkflow` histories remain replayable and resumable with workflow ID
   `coding-<runId>`; new histories never reuse that ID. Kill/retry does not duplicate result or callback.
8. Legacy birth metadata is deterministic and labeled reconstructed. New Run birth metadata is event-native and
   fixes definition version/hash, prompt hash, runtime profile/version, task schema, and result schema.
9. Activating a new Coding Agent version affects only future Runs. Existing T18 and T19 Runs never consult a
   mutable active pointer during replay/resume.
10. The canonical Host/fold/persistence ports contain no `coding.execute`, Git, Writing, Codex, or Provider-name
    branches. Specialization adapters may contain their own domain terms.
11. T18 acceptance remains a proposal: agent/system cannot accept; human acceptance revalidates base, paths,
    hashes, and observed tests and still records `merged=false/deployed=false/activated=false`.
12. A deployment with an unavailable exact Runtime Profile fails before workspace/resource mutation and never
    switches to the legacy dispatcher or another Provider.

## Red tests to add before migration code

| Test | Initial red assertion |
| --- | --- |
| `packages/engine/src/agent-run/legacy-capability-run.test.ts` | Archived T18 event sequences decode to one canonical Run; full/incremental replay hashes match; the reconstructed birth descriptor is stable. |
| `packages/engine/src/agent-run/run.test.ts` | A Writing-shaped task with no repository/base fields completes lifecycle; needs-input and resource approval resume the same birth-fixed Run. |
| `packages/engine/src/agent-run/source-governance.test.ts` | Generic Agent Run modules contain no coding/writing/provider/Git names or imports. |
| `apps/web/src/db/agent-runs.test.ts` | Empty rebuild over mixed legacy/native events yields one projection, one source creation, stable hash, and strict owner/scope isolation. |
| `apps/web/src/db/agent-runs.test.ts` | Concurrent legacy/native create attempts for one `source.eventId` produce exactly one Run rather than two projections. |
| `apps/web/src/engine/agent-runs.test.ts` | A frozen T18 Siren fixture is unchanged through `capability-run:<id>`, while `agent-run:<id>` exposes birth refs without Provider secrets. |
| `apps/web/src/engine/agent-runs.test.ts` | Capability dispatch resolves an exact definition/runtime and never branches on `coding.execute` or accepts request-side provider/profile/sandbox overrides. |
| `apps/web/src/engine/capability-source-callback.test.ts` | Legacy and native Runs use the same guarded, idempotent source callback; replay/retry appends no second terminal action. |
| `apps/web/src/temporal/agent-run.test.ts` | Cancellation derives `coding-` versus `agent-` workflow ID from persisted origin and cannot cancel the wrong workflow. |
| `apps/worker/src/agents/host/temporal-compatibility.integration.test.ts` | A frozen T18 `codingCapabilityWorkflow` history replays/resumes after worker replacement; new generic workflow kill/resume also finalizes exactly once. |
| `apps/worker/src/agents/coding/t18-compatibility.test.ts` | Generic envelopes round-trip to the exact old Coding task/result/event shapes and retain main-checkout/no-merge Safety. |
| `e2e/t19-specialized-agents.spec.ts` | Existing T18 Coding route and new Agent Run route point to the same Run truth and source entity; definition upgrades do not alter an older Run. |

Targeted verification commands once those tests exist:

```bash
pnpm vitest run packages/engine/src/agent-run/legacy-capability-run.test.ts \
  packages/engine/src/agent-run/run.test.ts \
  apps/web/src/db/agent-runs.test.ts \
  apps/web/src/engine/agent-runs.test.ts \
  apps/web/src/engine/capability-source-callback.test.ts \
  apps/web/src/temporal/agent-run.test.ts \
  apps/worker/src/agents/coding/t18-compatibility.test.ts

RUN_T18_TEMPORAL=1 CI=true pnpm vitest run \
  apps/worker/src/agents/host/temporal-compatibility.integration.test.ts

pnpm eval:t18
CI=true pnpm e2e e2e/t18-coding-capability.spec.ts e2e/t19-specialized-agents.spec.ts
```

## Exit decision

Proceed with Option B. Treat T18 wire formats as an immutable legacy generation, not as the new generic model
and not as data to rewrite. Build one generic Agent Run kernel/projection, read old and new events through
versioned codecs, preserve old HTTP and Temporal surfaces through adapters, and send all future specialization
Runs through the native birth-fixed event family. This is the only option that simultaneously preserves T18,
establishes truthful T19 contracts, and avoids both a big-bang rewrite and permanent dual runtime truth.
