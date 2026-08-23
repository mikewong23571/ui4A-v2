# T20 Meta Human Control Plane — DONE

T20 is complete. UI4A now exposes its existing Meta contracts as a usable, elegant and deterministic human
control plane rather than a hardcoded four-link BIOS page.

## Delivered

- Sitemap-driven seven-face dashboard, authorized Scope selector, bounded summary search and URL-restored filters.
- Canonical generic Meta deep link and class/priority renderer registry with fail-closed ambiguity.
- Safe generic collection/detail fallback with redacted raw audit disclosure.
- Task-first Application map with slim summaries, Flow/Capability/Policy/provenance and bidirectional links.
- Scoped Agent Definition contract view separating sealed authority, typed bindings and deployment requirements.
- Draft review workbench with blockers, structured issue repair, diff, checks, Eval, sources, provenance and
  human-only decision; Run/Definition/Draft birth links retain scope.
- Fresh-action submit, server-revalidated scope, no browser identity override, callback filtering, CAS recovery,
  revision-aware bounded cache and no exact-member N+1.
- Desktop/mobile screenshots, keyboard approval, future-surface fixture and warm-local performance gate.

## Acceptance

- U1-U22 and all four Golden Stories pass; Mechanical Safety 100%.
- `pnpm check`: 238 files passed, 3 skipped; 1635 tests passed, 3 skipped.
- `CI=true pnpm e2e`: 43 passed, 29 environment-gated skipped, 0 failed.
- T20 Playwright: 8/8; warm local detail p50 67 ms, p95 77 ms.
- Live stack: Web/database healthy, seven governance faces visible, Temporal UI 200, Worker RUNNING.
- Principal review: no remaining findings; see `review.md`.

The local identity mode remains explicitly self-reported demo scope. Production SSO/multi-tenant IAM and full
Application authoring remain out of scope.
