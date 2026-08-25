# T19 Architecture — Specialized Agent Contracts

## Core model

```text
Application Capability/Flow
  what the business wants
            │ capability ref + task mapping
            ▼
AgentDefinition@version
  prompt + task/result + runtime/tool/resource/eval contract
            │ resolved requirements
            ▼
RuntimeProfile
  provider + environment + concrete resource backends
            │
            ▼
agent-run:<id>
  fixed definition/prompt/runtime/task birth refs
            │
            ▼
Result Proposal ──► verifier ──► Application action/Draft/human decision
```

Capability、Agent Definition 和 Runtime Profile 分别回答“做什么”“哪类 Agent 如何做”“部署在哪里
执行”。任何两层合并都会造成 Application 绑定 Provider、Prompt 获得权限或 Runtime 硬编码业务。

## Module boundaries

```text
packages/shared/src/agent-definition.ts
  wire DTOs, schema versions, limits, refs, policies, task/result envelopes

packages/engine/src/agent-definition/
  parse, canonicalize, derive/flatten, invariants, diff, registry fold

packages/engine/src/agent-run/
  pure lifecycle, grants, questions, result proposal, idempotency/CAS

packages/agent/src/specialization/
  prompt compilation and provider-neutral runtime messages

apps/web/src/db/agent-definitions.ts
  append-only events, content-addressed templates/evals, rebuildable registry

apps/web/src/engine/agent-definitions.ts
  Siren/meta/Draft/activation/runtime-preflight composition

apps/web/src/engine/agent-runs.ts
  Run projection, capability/source bridge, human decisions

apps/worker/src/agents/host/
  generic Temporal activities, Runtime registry, tool/resource intersection

apps/worker/src/agents/coding/
  T18 task/result/worktree/Git/test specialization adapters

apps/worker/src/agents/writing/
  brief/result/document workspace/source/citation/render adapters
```

Dependency direction remains `shared ← engine ← agent`; Web/Worker compose adapters. Generic Host modules
must not import specialization modules. Specializations implement Host ports and may depend on their resource
backends.

## Definition lifecycle

```text
draft → validated → pending-approval → active → deprecated
          │                 │
          └─ failed checks  └─ human-only decision
```

Agent-authored definitions use T17 Draft payload/CAS/provenance. Activation resolves the exact parent version,
flattens the definition, compiles Prompt bindings, verifies runtime/tool/verifier availability and attaches Eval
evidence. The active event stores the flattened hash and all source refs. Execution never follows a mutable
`extends` pointer.

## Prompt contract

Prompt Template is structured data, not executable template code:

```text
blocks[] = { role, purpose, literal?, binding? }
binding = { source: task|context|policy, pointer, encoding, required }
```

System/authority blocks can only originate from the activated definition and runtime policy. Task/context values
are encoded as delimited data blocks. Template compilation produces canonical messages plus a hash stored on the
Run. Prompt text guides cognition but never grants tools, resources, identity or approval.

## Runtime and grants

Definition requirements are abstract: `runtimeClass`, features, tool/resource categories. Deployment profiles
map them to Provider SDKs, workspace backends and environment allowlists. Effective grants are an intersection:

```text
definition ceiling
∩ capability/application policy
∩ principal authorization
∩ run-specific approved grants
```

No request-side field can widen the set. Needs-input and resource approval suspend the same durable Run; result
approval stays independent.

## Compatibility strategy

T18 remains the behavioral baseline. Phase A must probe whether to evolve `capability-run` storage in place or
introduce `agent-run` with a compatibility projection. The chosen migration must keep old T18 events readable,
avoid dual truth, and preserve `coding-agent@1` birth/provenance. No big-bang rewrite is allowed.

## Acceptance architecture

- Mechanical corpus: contracts, bindings, derivation, grants, CAS, replay, no self-approval.
- Runtime corpus: real Temporal kill/cancel/questions/grants and callback idempotency.
- Coding corpus: rerun T18 five variants and Safety unchanged.
- Writing corpus: five real briefs, rubric ≥80%, citation/render Safety 100%.
- Authoring corpus: five natural phrasings produce ≥4 mechanically valid Agent Definition Drafts.
- Browser corpus: discovery, contract/diff/evidence, questions/grants and human activation on desktop/mobile.

Exact prompts, reasoning, tool order and prose are not acceptance snapshots.
