# T21 Assistant 双焦点事实与 AI-first Presentation 一致性 — DONE

T21 is complete. The reference Assistant no longer treats its request-scoped contract entity as the user's current
page. It receives separate replayable `lastNavigation` and current-message `clientView` facts, and the configured
LLM decides how to answer, clarify, navigate or present without deterministic phrase routing.

## Closure

- U1–U8 and the four-turn Golden Story are covered by mechanical, real-LLM and real-browser evidence.
- Canonical browser completion is 100%; final natural-language variants are 4/4; Mechanical Safety is 100%.
- Full `pnpm check`, `CI=true pnpm e2e`, live managed stack and Canvas walkthrough pass.
- D33 records the binding architecture; no technology-stack change was required.

See `acceptance-report.md`, `safety.md`, `evidence.md` and the Phase checkpoint Git notes for exact commands and
results.
