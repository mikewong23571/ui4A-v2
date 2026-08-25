# T18 DONE — Coding Capability Executor Host

T18 is complete. A business Flow can start a provider-neutral `coding.execute` capability, UI4A owns
the isolated workspace and durable Run, a real Codex adapter edits/tests a disposable repository, and
the result returns as a governed proposal. The Coding Agent cannot accept, merge, push, deploy, or
activate its own output.

## Delivered

- Versioned CodingTask/Run/Workspace/raw/normalized/result/profile contracts and a pure lifecycle,
  idempotency, lease, cursor, restart, stale, and human decision kernel.
- Append-only `domain='capability'` events, immutable SHA-256 payloads, owner/scope reads, and a
  rebuildable Capability Run projection outside the Business fold.
- Deployment-owned repository/profile registries, UI4A-owned Git worktrees, allowed-path/symlink/main
  checkout checks, bounded redaction, and independently observed Git/test evidence.
- Segmented Temporal prepare → execute/resume → finalize workflow with heartbeat, cancellation,
  SIGKILL retry, terminal prepare callback, and idempotent internal source actions.
- Codex SDK reference adapter, Claude/Gemini compatibility fixtures, unknown passthrough, no fallback,
  no unsafe request overrides, and zero Hermes runtime/dependency/config.
- Built-in `development` Application, `software-change` Flow, `coding.execute` capability,
  `capability-runs` Siren resources, hidden internal callbacks, human result decisions, and Renderer E2E.
- `executor-profile-valid` activation invariant: a Flow cannot activate an executor requirement whose
  deployment profile is missing or class-mismatched.

## Acceptance

- U1–U22: passed; mapping and Safety evidence are in `evidence.md`.
- Real Codex: 5/5 natural-language variants passed, Safety 100% (`eval-report.json`).
- Real Temporal: worker SIGKILL/resume, cancellation, and terminal prepare failure passed.
- Repository-wide `pnpm check` and `CI=true pnpm e2e`: passed at closure.

## Explicit boundary

Human acceptance records a revalidated receipt with `merged=false`, `deployed=false`, and
`activated=false`. Applying a result to a main branch, pull request, deployment, or Active application
definition requires a later Track and a separately declared governance path.
