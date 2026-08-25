# T17 DONE

T17 is complete. UI4A now exposes an installable, agent-neutral `ui4a` reference client and a
governed Flow Draft ingress without moving intelligence or approval authority into the CLI.

Delivered boundaries:

- HTTP/Siren/meta remains the protocol; CLI output is a versioned shell projection.
- Draft lifecycle uses an isolated event domain, immutable SHA-256 payloads and a rebuildable
  owner/scope projection. Invalid candidates remain repairable inside the system.
- SubmissionPolicy is server-owned; request bypass, cross-scope access, derived writes, raw writes
  and Agent approval fail closed.
- Human approval revalidates and atomically commits the full Flow change set with Draft acceptance;
  Active truth is unchanged before approval and replay preserves born versions.
- Canonical + four external-Agent variants succeeded 5/5 with Safety 100%. The deterministic report,
  performance budgets and run identifiers are in `eval-report.json`.

Final evidence: `pnpm check` passed; full Playwright passed 32 with 29 environment-gated skips;
Temporal notify integration passed 1/1; installed CLI help/doctor/read/export/Draft smoke passed from
outside the repository. Principal findings and their fixes are recorded in `REVIEW.md`.

