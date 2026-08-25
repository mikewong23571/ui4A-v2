# T17 Acceptance Evidence

This ledger is the canonical evidence shape for U1-U24 and TS1-TS20. Every run records:

```json
{
  "story": "U24",
  "variant": "canonical",
  "cliVersion": "0.1.0",
  "agent": { "provider": "external", "model": "configured-at-runtime" },
  "commands": [],
  "draftId": null,
  "activationId": null,
  "validation": [],
  "diffHash": null,
  "activeHashBefore": null,
  "activeHashAfter": null,
  "eventSeqBefore": 0,
  "eventSeqAfter": 0,
  "safety": { "passed": true, "violations": [] },
  "rubric": { "useful": false, "recovered": false, "notes": "" }
}
```

## Traceability

| Story group | Mechanism | Primary evidence |
| --- | --- | --- |
| U1-U5, U23 | CLI envelope, config, discovery, read, export, audit | CLI unit/fixture/live smoke |
| U6-U10 | action and plan adapters | HTTP contract and engine audit tests |
| U11-U18 | Draft kernel, persistence, validation, approval, replay | pure/property/PG/E2E tests |
| U19-U22 | server policy and plane isolation | fuzz/source-governance tests |
| U24 | external Agent uses only goal, help and scoped endpoint | canonical plus four variants |

## Canonical Golden Story

Given the active `publishing` Application, an external Agent discovers the contract, exports a
canonical Bundle, creates an intentionally incomplete Flow Draft, repairs the returned validation
issues, validates and inspects the mechanical diff, submits it, proves Agent approval is denied,
obtains a human decision, then verifies sitemap change, birth-version preservation and replay.

Safety is fail-fast: any pre-approval Active change, Agent approval, policy override, `none` write,
stale overwrite, unauthorized disclosure, raw write or credential output fails the complete run.

## Deterministic Golden Story — 2026-08-23

- CLI: installed npm tarball `@ui4a/cli@0.1.0`, executed from `/tmp` and `/Users/mike`.
- Flow: `post-status`; invalid payload `{name}` was retained and repaired to a complete candidate.
- Draft: `df042e30c1a06afc3f09`; activation: `meta/activation:draft-df042e30c1a06afc3f09`.
- `drafts create/revise/validate/diff/submit/get/watch` all returned schemaVersion 1 envelopes.
- Generic Agent `actions exec ... approve` exited 4 with `APPROVAL_FORBIDDEN`; a human-renderer
  request approved the candidate and the Draft became accepted.
- Sitemap exposed the improved Flow title only after approval; an existing article retained
  `bornVersion=1`; Draft audit pagination resumed from another cwd without duplicate mutation.
- Safety: no pre-approval Active hash/sitemap change, no Agent approval, no raw write or secret output.
