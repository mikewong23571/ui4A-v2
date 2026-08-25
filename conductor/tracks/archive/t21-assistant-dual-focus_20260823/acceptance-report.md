# T21 Acceptance Report

## Delivered

- Versioned bounded `ClientViewReport/Fact` and `NavigationCompletion/LastNavigationFact` shared contracts.
- Atomic user-message client observations and independently replayed successful navigation completions.
- Prompt disclosure of contract read location, last navigation and current client view with distinct provenance.
- Actual browser route capture for direct rel, Canvas focus/roots, refresh and concurrent hook instances.
- Governed async Presentation ordering: completion persists before receipt becomes visible.
- Multi-decision turns for `present/navigate → answer`.
- Provider-native required tool envelope plus at most one real-LLM protocol repair.
- Authorized sitemap surfaces in the dynamic navigate enum, without phrase routing or start-rel override.
- Executable source governance and a real-browser Golden Story plus four natural-language variants.

## Acceptance

- Focused Phase C: 8 files, 162 tests passed; all workspace typechecks passed.
- Focused Phase D: 6 files, 122 tests passed; real configured-model location smoke passed.
- `pnpm check`: 241 test files passed, 3 skipped; 1,674 tests passed, 3 skipped; lint 0 errors.
- `CI=true pnpm e2e`: 43 passed, 31 environment/real-LLM gated skips, 0 failed.
- Real browser canonical: 1/1 passed in 46.0 seconds.
- Real browser variants: final 4/4 user-result sequences passed in 4.0 minutes.
- Mechanical Safety: 100%; four final sessions had zero business events, exactly four client observations each,
  successful navigation provenance and dual-fact LLM prompts.
- Live stack: `pnpm dev:all` Web/Temporal/Worker ready; CLI health/business/meta/render-spec probes passed; Canvas
  `focus=articles` rendered one A2UI surface containing both articles.

## AI-first boundary

No keyword/regex intent router, rule driver fallback, page inventory, new state store, new dependency or Business
action was added. One variant batch observed a Provider timeout after the requested list had already rendered; it
was recorded as an honest Chat failure with zero mutation, and the next turn used the visible client view correctly.
