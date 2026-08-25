# T17 Technical Architecture — Accepted

> Phase A disposable probes 已完成，决定冻结于全局 D29。本文保留候选方案的推导，
> 下面“Phase A Open Decisions”已由“Accepted Decisions”取代。

## 1. Boundary

```text
External Agent
  owns: intent understanding, reasoning, code/data editing, recovery strategy
       │
       │ ui4a CLI — stable, composable reference client; no LLM
       ▼
UI4A HTTP/Siren/meta protocol
  owns: facts, disclosure, submission policy, actions, schemas, guards
       │
       ├──────── direct action ───────► Business judgment/effect
       ├──────── draft ingress ───────► Draft lifecycle/approval/apply
       └──────── high risk ───────────► Confirmation/human decision
```

HTTP + Siren + meta remains the protocol and source of truth. CLI output is a versioned projection for shell composition, not a competing definition language or state store.

## 2. Proposed Module Map

```text
apps/cli/
  main/commands/config/http/json-envelope/redaction
  discover/entity/action/plan/bundle/draft/activation/audit/request

packages/shared/src/submission.ts
  SubmissionPolicy, Draft envelope, CLI wire DTOs/version constants

packages/engine/src/submission/
  policy resolver, Draft state machine, commands/events/fold,
  validation decision, CAS/conflict, diff/apply decision

apps/web/src/db/drafts.ts
  PostgreSQL event adapter + rebuildable draft projection

apps/web/src/engine/drafts.ts
  policy context, validation registries, activation/apply adapters

apps/web meta projections
  meta/drafts collection + draft:<id> Siren entities
  existing /_meta/api/entity and /_meta/api/exec

existing definition/activation/presentation modules
  human approval, active fold, sitemap, Recipe/Sidecar invalidation
```

Dependency direction remains `shared ← engine ← agent`, with `apps/cli` and `apps/web` composing packages. `apps/cli` must not import `apps/web` or connect to PostgreSQL/Temporal directly.

## 3. Submission Policy

Candidate shared contract:

```ts
type SubmissionMode = 'draft' | 'direct' | 'none';

interface SubmissionPolicy {
  mode: SubmissionMode;
  actors?: ('human' | 'agent' | 'system')[];
  scopes?: string[];
  reason?: string;
}
```

Resolution uses activated definitions + actor credential + policy scope. Request fields cannot override it.

```text
external writable + unspecified ──► draft
explicit low-risk direct          ──► direct + normal judgment
derived/read-only/audit           ──► none
high-risk action                  ──► confirmation (unless content ingress is itself a Draft)
Presentation preference           ──► Sidecar lifecycle, never Draft
```

Activation invariants should reject `direct` definitions that lack a declared action/schema/authorization basis, and reject `none` resources that expose write actions.

## 4. Draft Aggregate

Candidate serializable shape:

```ts
interface DraftKey {
  principal: string;
  policyScope: string;
  kind: 'entity-create' | 'entity-patch' | 'application-bundle' | 'flow-definition';
  target?: string;
}

interface DraftVersionInput {
  baseVersion?: string;
  payload: unknown;
  payloadHash: string;
  schemaRef: string;
  provenance: {
    actor: 'agent' | 'human';
    agent?: string;
    model?: string;
    commandId: string;
    sources: string[];
  };
}

interface DraftVersion extends DraftVersionInput {
  version: number;
  basedOnVersion: number | null;
  validation: DraftValidation;
  status: DraftStatus;
}
```

Envelope validation happens before payload persistence. Payload schema/invariant failure produces an `invalid` Draft, not a rejected HTTP envelope, so the Agent can repair it inside the system. Hard budgets cover byte size, nesting, content type, Draft count and retention.

## 5. Lifecycle

```text
create ──► editing
             │ validate fail
             ▼
           invalid ── revise ──► editing
             │ validate pass
             ▼
            ready ── submit ──► pending-approval
                                      │
                         human approve├──► accepted
                         human reject ├──► rejected
                         target drift └──► stale

editing/invalid/ready ── abandon ──► abandoned
nonterminal retention timeout ──────► expired
```

Versions are immutable. `revise` uses active Draft version CAS; rebase after target drift creates a new version with explicit old/new base evidence. `accepted/rejected/abandoned/expired` cannot be mutated; continuing work forks a new Draft lineage.

## 6. Event and Projection Model

Candidate event family:

```text
draft-created
draft-revised
draft-validated
draft-submitted
draft-staled
draft-abandoned
draft-accepted
draft-rejected
draft-expired
```

All include eventId/commandId/draftId, owner and provenance. A pure fold produces Draft aggregates and lookup indexes. PostgreSQL projection is rebuildable and may index principal/policyScope/kind/target/status/updatedSeq.

Draft events share the current `events` table under `domain='draft'`。完整 payload 存入 immutable
content-addressed `draft_payloads`，事件只存 SHA-256；`draft_projection` 可删除重建。该模式复用
Presentation 已验证的 domain/fold/projection 结构，同时避免完整 Flow 每版重复进入日志。

## 7. Siren/Meta Interface

The preferred API stays hypermedia-first:

```text
GET  /_meta/api/entity?rel=meta/drafts
POST /_meta/api/exec {rel:"meta/drafts", action:"create", ...}

GET  /_meta/api/entity?rel=draft:<id>
POST /_meta/api/exec {rel:"draft:<id>", action:"revise|validate|submit|abandon", ...}

GET  /_meta/api/entity?rel=meta/activation:<id>
POST /_meta/api/exec {rel:"meta/activation:<id>", action:"approve|reject", actor:"human"}
```

No privileged CLI-only Draft CRUD API is planned. If payload upload size makes normal action fields impractical, Phase A may introduce a content-addressed upload primitive, but the returned reference still enters through a declared Draft action.

## 8. Atomic Apply

The first slice modifies one existing Flow inside an Application. Approval must:

1. lock Draft and target definition;
2. reload principal/actor policy and active target version;
3. re-run parser/schema/invariants/registries;
4. compare baseVersion/dependency fingerprints;
5. append one atomic activation decision or one transactionally grouped event set;
6. mark Draft accepted with activation and target version references;
7. invalidate affected Recipe/Sidecar dependencies and regenerate asynchronously.

Phase A compared two options:

- one `candidate-applied` event carrying the validated change set;
- transactionally append existing definition/activation events plus an apply receipt.

选择单个 `definition-candidate-applied` core event，与 `draft-accepted` 在同一 PostgreSQL 事务
提交。完整 validated change set 可独立重放 active pointer、版本历史和 approved activation；
无需在 Draft 之外复制 definition draft/pending 状态。Creating a new Application Bundle atomically is deferred until this slice is proven.

## 9. CLI Command Surface

Candidate TypeScript CLI workspace: `apps/cli`, package/bin name `ui4a`.

```text
ui4a --json doctor

ui4a apps list|show
ui4a flows list|show
ui4a entities get
ui4a actions list|exec
ui4a plans submit
ui4a bundles export|validate|diff

ui4a drafts create|get|list|revise|validate|diff|submit|watch|abandon
ui4a activations get|watch
ui4a audit session|entity|definition|draft
ui4a request get|head
```

Product nouns precede verbs; all lists have `--limit` and cursor/afterSeq. Write commands accept the narrowest stable rel/id, support `--dry-run` where meaningful and never combine discovery, editing, submit and approval into `fix/auto/improve`.

JSON envelope candidate:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "drafts.validate",
  "data": {},
  "page": { "nextCursor": null },
  "meta": { "protocolVersion": "...", "requestId": "..." }
}
```

Error shape includes `code/message/status/details/retryable/requestId` and never credentials. Progress and watch diagnostics go to stderr or JSONL only when explicitly selected.

## 10. Trust and Authorization

- Credential establishes principal, delegated actor/agent identity and scopes; CLI flags do not.
- Current self-reported local demo remains visibly labeled and cannot be treated as production authorization evidence.
- Agent may create/revise/validate/submit/abandon its permitted Drafts and execute permitted business actions.
- `approve/reject` is omitted from Agent CLI command families; raw writes cannot recover it.
- Server reauthorizes every Entity/link/target on each operation and filters audit/list results by principal/policy scope.
- Draft payload is untrusted input: bounded parse, no code execution, no UI/component/CSS, no secret echo.

## 11. External Agent Evaluation

The real Agent receives only:

- a user-level improvement goal;
- installed `ui4a` command and `--help`;
- a scoped credential and test endpoint.

It does not receive source code, action names, Draft IDs or repair hints. Evidence records CLI version, commands, JSON results, validation issues, Draft/Activation IDs, Active hashes and events. A mechanical evaluator checks Safety; a human/LLM rubric checks usefulness without requiring exact commands or prose.

Scripted callers may prove protocol mechanics but do not prove U24.

## 12. Accepted Decisions

1. Shared `events` table + isolated `draft` domain + independent pure fold.
2. SHA-256 content-addressed JSON payloads; 256 KiB/depth 32/node 20k/version 32 budgets.
3. One core `definition-candidate-applied` change set + same-transaction `draft-accepted`.
4. Server-owned SubmissionPolicy; `none` absorbing, explicit governed direct, writable default draft.
5. CLI envelope `schemaVersion:1` and exit-code taxonomy frozen by D29.
6. Local demo remains visibly self-reported; production credential adapter is not falsely claimed.
7. Companion Codex skill ships only after CLI smoke and remains optional/agent-neutral.
