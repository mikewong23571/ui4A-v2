# T18 Acceptance Evidence

## Verdict

U1–U22 are closed. The real Codex corpus completed 5/5 variants (100%, gate ≥80%) with Safety
5/5. Every run edited only `src/index.js` in an UI4A-owned disposable worktree, observed a passing
test command, denied Agent acceptance, produced a human non-merge receipt, and left the fixture main
checkout clean. Full evidence is in `eval-report.json`.

## User-story matrix

| Stories | Acceptance evidence |
|---|---|
| U1–U4 | Built-in `development` Application, `software-change` Flow, `coding.execute` definition, schema/parser/sitemap tests, request override rejection, repository registry/path traversal tests, and `executor-profile-valid` activation invariant. |
| U5–U8 | Capability Run lifecycle/fold/cursor tests; bounded raw/normalized persistence; Siren progress/raw links; idempotent cancel/budget/failure tests. |
| U6–U7 | `temporal.integration.test.ts`: real Temporal worker SIGKILL → retry → exactly-one finalize, plus workflow cancellation → CANCELLED and zero success finalize. |
| U9–U10 | Codex probe/auth tests, one-attempt terminal preflight, no Provider fallback, controlled env/workspace-write sandbox, and execution approval separated from result decision. |
| U11–U16 | Independent Git diff/test observation, content-addressed patch/trajectory, human-only result decision, base/path/hash/test CAS, stale/duplicate/concurrency/worktree isolation tests, and receipts fixed to no merge/deploy/activate. |
| U17 | Real `@openai/codex-sdk` smoke plus five persisted Run/worktree/result evaluations with native thread IDs. |
| U18–U20 | Claude/Gemini stream fixtures map through one normalized SPI; unknown events pass through; source governance proves zero Hermes runtime/import/config and no shell/unsafe-sandbox shortcuts. |
| U21 | `e2e/t18-coding-capability.spec.ts`: desktop/mobile discovery, software-change start action, internal callbacks hidden, and no overflow. Existing renderer/action fuzz remains green. |
| U22 | `pnpm eval:t18`: sum, clamp, unique, slugify, and chunk natural-language variants all succeeded in 18.1–30.2 seconds executor time; Safety 100%. |

## Mechanical safety

- Requests cannot override provider, binary, model, profile, cwd, sandbox, or unsafe mode.
- Repository resolution rejects absolute/broad/traversal/scope-invalid targets; allowed-path and symlink
  checks run again when collecting the result.
- Raw chunks are redacted and capped at 64 KiB each, 4 MiB/2,000 events per Run.
- Capability events and projections are outside the Business fold; replay rebuilds projections from
  append-only events and immutable payloads.
- Provider test/file claims are not trusted: the result uses observed command exit codes and Git diff.
- Agent result decisions are denied. Human acceptance revalidates Run revision, result ID, base HEAD,
  changed paths, patch/trajectory hashes, and test evidence; it records no merge/push/deploy/activation.

## Verification record (2026-08-23 SGT)

```text
pnpm check
  189 test files passed, 1 opt-in file skipped
  1453 tests passed, 1 skipped

CI=true pnpm e2e
  40 passed, 22 gated/legacy-real-LLM scenarios skipped

pnpm vitest run apps/worker/src/capabilities/coding/temporal.integration.test.ts
  3 passed against real Temporal dev server

pnpm eval:t18
  5/5 real Codex variants, successRate=1, safetyPassed=true
```

The full Playwright run used live Temporal for S1 workflow coverage. T18 kill/cancel has its own
non-skipped live-Temporal integration evidence. Real Codex evaluation uses `ui4a_test` and disposable
repositories; it never grants the executor this repository as a target.
