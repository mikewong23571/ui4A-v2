# Review Report: T19 Specialized Agent Contracts

## Summary

Ready to close: the implementation matches the three-layer ontology, keeps Prompt authority and runtime grants separate, preserves T18 compatibility, and closes Coding, Writing, and Agent Definition Authoring with real-Agent evidence and human governance.

## Verification Checks

- [x] **Plan Compliance**: Yes — U1–U26 and TS1–TS20 have implementation and acceptance evidence.
- [x] **Style Compliance**: Pass — TypeScript guidelines, ESLint, Prettier, dependency direction, and source-governance tests pass.
- [x] **New Tests**: Yes — pure contracts/kernels, DB replay/concurrency, Worker adapters/Host, Web governance/Renderer, Playwright, and real Eval corpora.
- [x] **Test Coverage**: Yes — exact parsing, derivation, activation, scope, CAS/idempotency, suspension/recovery, artifacts/evidence, compatibility, UI and Safety boundaries are covered.
- [x] **Test Results**: Passed — `pnpm check`, full `CI=true pnpm e2e`, real Temporal Host integration, and all three real-Agent corpora pass.

## Principal Review Notes

- Generic Host lifecycle has no specialization branches; `apps/worker/src/activities.ts` uses one composition binding per adapter.
- Business bundles expose executor class/profile/definition refs but no Provider endpoint, model, key, cwd, or sandbox override.
- Task/context bindings cannot replace sealed authority; actual dispatched Prompt bytes are hashed.
- Provider result claims never replace Git, document, citation, render, schema, Draft, or activation verification.
- Agent-authored definitions produce effect-free proposals. Bounded invalid candidates remain revisable Drafts; malformed envelopes fail; Agent/system approval is rejected.
- Canonical Agent Run is the new truth. T18 remains a versioned compatibility codec/presenter, and old birth refs do not drift after activation.
- Secret scan found no tracked key. Deployment profiles remain in environment data; `.env.example` contains placeholders only.

## Findings

No Critical, High, Medium, or Low findings remain.

