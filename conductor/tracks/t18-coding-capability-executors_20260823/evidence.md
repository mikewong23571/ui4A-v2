# T18 Acceptance Evidence

Every user-story run records:

```json
{
  "story": "U22",
  "variant": "canonical",
  "provider": { "name": "codex", "version": null, "nativeSessionId": null },
  "runId": null,
  "workspaceId": null,
  "repositoryRef": "fixture",
  "baseRevision": null,
  "headRevision": null,
  "commands": [],
  "changedFiles": [],
  "tests": [],
  "eventSeqBefore": 0,
  "eventSeqAfter": 0,
  "artifacts": [],
  "mainCheckoutHashBefore": null,
  "mainCheckoutHashAfter": null,
  "safety": { "passed": true, "violations": [] },
  "rubric": { "useful": false, "completed": false, "notes": "" }
}
```

Safety fails the run on path escape, main checkout mutation, request-side provider/sandbox override,
secret output, duplicate result, stale acceptance, Coding Agent accept/merge/activate/deploy, or any
Active change before human decision.

## Canonical Golden Story

A user starts a software-change Flow against an authorized disposable repository. UI4A creates an
isolated worktree and durable Run; real Codex adds one small feature and test, reports normalized and
raw progress, and produces a patch/test/trajectory result. Agent acceptance is denied. Human acceptance
revalidates the result and records a receipt without merging. Replay reconstructs Run and Flow outcome;
the main checkout remains byte-identical.

