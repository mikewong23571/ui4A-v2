# T18 Architecture — Accepted After Phase A Probes

## Boundary

```text
Application Flow/action
        │ spawn coding.execute
        ▼
Capability Run Plane (UI4A truth)
  policy / lifecycle / events / projection / artifact / human decision
        │
        ├─ Workspace Backend ──► isolated git worktree
        └─ Executor Provider ──► Codex reference / future adapters
```

Capability Run 不进入 Business `EngineSnapshot`，但 final callback 是普通业务 action。Coding Agent
不能直接写业务日志、审批实体或 Active definition；它只写被分配的 workspace。

## Module Map

```text
packages/shared/src/coding-executor.ts
  wire DTOs, event/result schemas, budgets

packages/engine/src/capability-run/
  lifecycle, commands/events/fold, profile/workspace/result decisions

apps/web/src/db/capability-runs.ts
  events domain, content-addressed raw/result payloads, rebuildable projection

apps/web/src/engine/capability-runs.ts
  Siren projection, start/cancel/decision bridge, Temporal dispatch

apps/web/src/temporal/capability.ts
  start/cancel workflow client

apps/worker/src/capabilities/coding/
  workflow activities, registry, workspace manager, subprocess transport, adapters
```

Dependency direction remains shared ← engine; web/worker compose adapters. Provider packages and Node APIs
never enter pure kernel. Existing `delegationWorkflow` remains unchanged: Delegation operates UI4A protocol;
Capability Run executes external work.

## Run Lifecycle

```text
queued → preparing → running ─────────► succeeded
                       │                   │
                       ├─ resource gate → waiting-approval ─► running
                       ├─ cancel ─────────► cancelled
                       ├─ provider/error ─► failed
                       └─ base drift ─────► stale

succeeded → human accept/reject occurs on source Flow; Run stays immutable succeeded.
```

## Executor Profile

Provider selection is deployment data, not request/Application data:

```ts
interface ExecutorProfile {
  name: string;
  provider: string;
  transport: 'sdk' | 'jsonl-process';
  workspaceBackend: string;
  sandbox: 'read-only' | 'workspace-write';
  timeoutSeconds: number;
  maxTurns?: number;
  envAllowlist: string[];
  networkPolicy: string;
}
```

Application capability declares an `executorClass` and optional policy-owned profile reference. Activation
verifies registry presence. Request fields cannot choose Provider/binary/sandbox/env.

## Workspace Ownership

- Repository registry maps stable `repositoryRef` to authorized server path and scope.
- UI4A resolves `baseRevision`, creates `ui4a/run-<id>` branch/worktree, records lease and snapshots main checkout.
- Provider receives only the workspace path via adapter context; raw user input never becomes cwd/argv.
- Acceptance compares expected/current base and result patch; first slice records receipt only and never merges.

## Codex Reference

Phase A compares official Codex SDK vs `codex exec --json`. SDK is preferred for application automation and
thread resume; JSONL CLI remains a disposable protocol probe and event fixture source. App Server is not used
unless SDK lacks required streaming/cancellation evidence.

## Hermes-derived Principles, No Hermes Runtime

Adopt: Runtime/Workspace separation, resume handle, worktree isolation, profile/tool scope, raw trajectory,
execution approval separate from result approval. Reject: Hermes dependency, gateway, global memory, skill
self-modification, Bot Mode, provider routing and agent-owned workspace. Source governance enforces the boundary.

## Accepted Decisions

1. `@openai/codex-sdk@0.149.0` production reference；JSONL CLI is fixture/diagnostic.
2. Shared events `domain='capability'` + independent fold/projection.
3. SHA-256 content-addressed raw/result chunks；64 KiB chunk，4 MiB/2000 event Run budget.
4. prepare → heartbeat execute/resume → finalize segmented Temporal workflow.
5. External repository registry maps stable ref/path/scope；request never supplies cwd/path.
6. Secret-protected internal callback executes declared Flow action as system principal.
7. UI4A-owned worktree retained through human decision；first slice never merges/pushes/deploys.
