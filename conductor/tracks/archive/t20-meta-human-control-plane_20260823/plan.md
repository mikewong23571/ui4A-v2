# T20 Meta Human Control Plane — Plan

## Phase A: Red baseline, spikes, UX contract and architecture decisions [checkpoint: 8ad2d5d]

- [x] Task: Freeze U1–U22 corpus, evidence schema, 4 Golden Stories, Mechanical Safety and 30/60/90-second human task protocol 8ad2d5d
- [x] Task: Red baseline — prove API/sitemap has 7 faces while `/meta` hardcodes 4; Application/Draft/Agent Definition and scope-aware human routes are absent 8ad2d5d
- [x] Task: Scope/auth spike — compare credential-owned scope, authorized scope selector and URL context; verify list/exact/action cannot be widened by browser input 8ad2d5d
- [x] Task: Router/registry spike — compare generic `/meta/entity`, catch-all routes and per-type pages; prove synthetic `meta/widgets` works without dashboard branches 8ad2d5d
- [x] Task: UX spike — produce desktop/mobile wireframes and test Application, Agent Definition and Draft information hierarchy with existing shadcn/RJSF/graph/diff components 8ad2d5d
- [x] Task: Performance spike — define request-count and p50/p95 measurement; prove collection embeds avoid N+1 and tabs can share revision-aware cache 8ad2d5d
- [x] Task: Record binding architecture decisions in DECISIONS/tech-stack before production code 8ad2d5d
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 8ad2d5d

## Phase B: Dynamic shell, authorized scope and generic fallback [checkpoint: 5d4db9f]

- [x] Task: TS1 Red→Green — pure sitemap-to-surface descriptors; top-level classification, href derivation and synthetic future surface 37d6440
- [x] Task: TS2 Red→Green — authorized scope transport/context, URL restoration and server-revalidated list/exact/action isolation 37d6440
- [x] Task: TS3/TS4 Red→Green — generic browser route and class-based renderer registry with ambiguity fail-closed 1530958
- [x] Task: TS5 Red→Green — elegant Meta dashboard, breadcrumbs, search/filter, pending/invalid summaries and honest loading/empty/error states 5d4db9f
- [x] Task: Generic collection/detail fallback — links/actions/raw disclosure, unknown class safety, no hardcoded product rels 1530958
- [x] Task: Source governance — prevent FACES/product-name routing, identity override, internal callbacks and non-action functional controls 37d6440
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 5d4db9f

## Phase C: Application map vertical slice [checkpoint: 1530958]

- [x] Task: U5/U6 Red→Green — Application list and pure view model for overview/flows/capabilities/policies/version/provenance 1530958
- [x] Task: Application Renderer — task-first header, relationship summary, tabs, graph/list choice and progressive raw Bundle disclosure 1530958
- [x] Task: U7/U8 Red→Green — bidirectional Application/Flow/Capability navigation and read-only boundary 37d6440
- [x] Task: Application Golden Story — 30-second orientation, desktop/mobile/keyboard/error states and request-count evidence 1530958
- [x] Task: Flow/Capability/Activation regression — existing routes and mechanical renderers remain available through dynamic shell 1530958
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 1530958

## Phase D: Scoped Agent Definition experience [checkpoint: 1530958]

- [x] Task: U9 Red→Green — scoped Agent Definition list/count/exact and cross-scope zero-leak browser behavior 37d6440
- [x] Task: U10/U11 Red→Green — Prompt/schema/runtime/policy/Eval/version view models with authority/binding/deployment separation 1530958
- [x] Task: Agent Definition Renderer — overview and progressive tabs, hash copy/expand, secret redaction and large schema states 1530958
- [x] Task: U12 Red→Green — Run/Draft/Definition birth-version links and post-activation old-Run stability 37d6440
- [x] Task: Agent Definition Golden Story — 60-second permission explanation, desktop/mobile/keyboard/performance evidence 1530958
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 1530958

## Phase E: Draft review and human governance closure [checkpoint: 616d231]

- [x] Task: U13 Red→Green — authorized Draft collection, filters, statuses, expiry and source links 37d6440
- [x] Task: U14/U15 Red→Green — invalid repair guidance, revision/CAS, authored/effective diff, checks, Eval, sources and raw audit 616d231
- [x] Task: U16 Red→Green — human decision surface, Agent/system rejection, reject reason, atomic approval and stale recovery 56d7cc8
- [x] Task: U17 Red→Green — Authoring Run → Draft deep link, invalid candidate, failure-zero-Draft and Draft back links 56d7cc8
- [x] Task: U18 Red→Green — refresh, partial failure, unauthorized, projection rebuild and decision-state recovery 56d7cc8
- [x] Task: Draft Golden Story — real Authoring Run through human activation; 90-second review budget plus action/audit evidence 616d231
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 616d231

## Phase F: UX refinement, accessibility, performance and executable governance [checkpoint: 616d231]

- [x] Task: U19 Red→Green — generic fallback/future surface without weakening specialized UX 1530958
- [x] Task: U20 Red→Green — full Meta action fuzz, current-entity reread, internal callback filtering and forged action rejection 56d7cc8
- [x] Task: U21 Red→Green — 390px responsive layouts, local diff/table overflow, keyboard/focus/a11y and partial loading boundaries 56d7cc8
- [x] Task: TS15 performance gate — no N+1, repeated-tab cache, bounded search and p50/p95 report against Phase A method 5d4db9f
- [x] Task: Visual QA — 1440×900/390×844 screenshot matrix, typography/hierarchy/density/status/error review and fixes 1530958
- [x] Task: U22 human walkthrough — 30/60/90-second tasks, clicks/hesitation/misreads/raw dependency; zero Critical/High UX findings 616d231
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 616d231

## Phase G: Full acceptance, documentation and Principal review [checkpoint: 04f7dc6]

- [x] Task: U1–U22 evidence matrix and all four Golden Stories complete; Mechanical Safety 100% 04f7dc6
- [x] Task: Full regression — `pnpm check`, `CI=true pnpm e2e`, replay, mobile/a11y, action fuzz and app health 616d231
- [x] Task: Sync GOAL/DECISIONS/product/tech/arch/runtime/audit/AGENTS/README/demo/DONE and Meta module map 04f7dc6
- [x] Task: Principal review — dynamic discovery, scope auth, renderer growth, human decision UX, action safety, zero-AI approval, performance and scope creep 616d231
- [x] Task: Final Phase Verification & Checkpoint (Refer to workflow.md) 04f7dc6

## Phase H: Review Fixes [checkpoint: 616d231]

- [x] Task: Apply Principal action, rel, cross-plane scope, cache, redaction and Draft refresh fixes 56d7cc8
- [x] Task: Replace raw Draft repair with issue-focused structured RJSF and preserve optional contracts b3bda32
- [x] Task: Support focused invalid-field deletion and final no-findings re-review 616d231
- [x] Task: Review Fixes Verification & Checkpoint 616d231
