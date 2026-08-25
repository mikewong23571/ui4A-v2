# Review Report: T17 External Agent CLI 与 Governed Draft Ingress

## Summary

The implementation is ready after fixing the review findings around payload duplication, policy
scope enforcement, cross-writer serialization, event integrity, CLI failure semantics, and Temporal
test isolation.

## Verification Checks

- [x] **Plan Compliance**: Yes — U1–U24 and TS1–TS20 have code/evidence paths; new-App creation remains out of scope.
- [x] **Style Compliance**: Pass — strict TypeScript, dependency direction, pure kernel and adapter boundaries preserved.
- [x] **New Tests**: Yes — kernel, DB, HTTP, CLI, replay, policy, Golden Story and source-governance coverage.
- [x] **Test Coverage**: Yes — new pure and safety branches are exercised; Safety corpus is fail-fast.
- [x] **Test Results**: Passed — `pnpm check`, focused Temporal integration, focused S2 E2E, CLI install/live smoke and T17 Eval.

## Findings Resolved

### High: Validated Flow payload was duplicated into Draft events

`validateFlowDraft` returns a normalized `value` for adapters, but persistence originally serialized
that value inside `validation`, defeating content-addressed payload storage. The adapter now stores
only `valid/issues/validatedAgainst`; a DB test proves revised events contain no `value` or `nodes`.

### High: Draft exact actions did not re-check credential policy scope

Owner-only lookup could allow the same principal under another scope to mutate a Draft. The route now
passes server context, create/exact/apply all enforce policy scope, and target Flow membership is
checked both at create and approval.

### High: Draft approval was outside the core engine mutation queue

Draft acceptance now runs through `EngineRuntime.runExclusive`, serializing the same-Flow apply with
normal business/meta mutations before the PostgreSQL flow lock/CAS transaction.

### Medium: Candidate apply event integrity checks were incomplete

The pure fold now validates schema/command, human actor, SHA-256 payload, artifact hash, next version,
target/name, checks, lifecycle state, duplicate version and duplicate activation.

### Medium: Running tests beside the development worker could cross-consume notifications

Worker and Temporal clients now honor isolated `UI4A_TASK_QUEUE` and `UI4A_WORKFLOW_PREFIX` values.
The integration test uses unique values and passed against a standalone Temporal server. The one
pre-fix stray development event was copied to `events_quarantine_t17_20260823` before exact removal.

### Medium: CLI doctor hid complete endpoint failure

Missing auth in local demo remains a successful diagnostic, but complete endpoint failure now returns
structured `NETWORK`, exit 8 and retryable evidence. Config parse/URL failures return `CONFIG`, exit 3.

