# T19 Red Baseline

Date: 2026-08-23 SGT

## Commands

```bash
rg -n "Coding|coding|capability-run|coding\\.execute|workspace|Git" \
  packages/shared/src/coding-executor.ts packages/engine/src/capability-run \
  apps/web/src/engine/capability-runs.ts apps/worker/src/capabilities/coding \
  apps/worker/src/workflows.ts apps/worker/src/activities.ts | wc -l

rg -n "AgentDefinition|agent-definition|agent-run|PromptTemplate|runtimeClass|WritingBrief|writing-agent" \
  packages apps
```

Observed result: the T18 path contains 417 coding/workspace/Git references. No AgentDefinition, PromptTemplate,
WritingBrief or writing-agent production contract exists. `CapabilityDefinition.executor` only names a class,
profile and features; it cannot version a Prompt, Task/Result contract, resource policy or verifier set.

## Concrete coupling

- `packages/shared/src/coding-executor.ts` defines CodingTask/CodingResult and Git-shaped evidence as the shared
  wire contract rather than a specialization adapter.
- `packages/engine/src/capability-run/` gives correct durable lifecycle/CAS semantics, but the aggregate embeds
  CodingTask, WorkspaceHandle and CodingResult.
- `apps/web/src/engine/capability-runs.ts` projects `capability='coding.execute'`, constructs CodingTask, reads
  Git HEAD at result decision and only accepts Codex provider profiles.
- `apps/worker/src/capabilities/coding/` combines provider transport, worktree backend, Git collection and test
  verification under one specialization directory; this is a good boundary to adapt, not delete.
- `apps/worker/src/workflows.ts` names CodingCapabilityWorkflowArgs/activities directly; no generic questions,
  resource approval or specialization dispatch exists.
- The built-in bundle directly maps `coding.execute` to executor profile `default`; no Agent Definition ref/version
  or Prompt provenance participates in discovery, activation or Run creation.

## Red claims

The following T19 user stories are mechanically false at baseline:

- U1/U2: no specialization registry or three-layer refs;
- U4/U21/U22: no Writing Agent or document runtime/verifiers;
- U6–U12: no Prompt/Task/Result/Runtime/Policy Agent Definition lifecycle;
- U13–U19: no generic Agent Run envelope, questions or grant intersection;
- U23–U26: no agent-definition Draft, activation or birth-version replay.

T18 U1–U22 remain green and are the migration safety baseline. The implementation must introduce the missing
contracts without relabeling these red claims as completed through type aliases alone.
