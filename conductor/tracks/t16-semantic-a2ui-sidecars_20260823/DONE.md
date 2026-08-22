# T16 Closure Report

## Outcome

T16 is closed at demo quality. Presentation is a separate plane: Chat emits a thin request; the runtime resolves user-level Sidecars and Application Recipes before generic/planner paths; semantic Surfaces remain binding-only and compile to A2UI; business actions still use live declaration/guard/schema/confirmation.

Human optimization now produces versioned semantic patches, supports pin/revert and explanation, and requires a human preview/confirmation before a de-identified Recipe becomes shared. Promotion payloads and Sidecars replay from Presentation events without entering the Business fold.

## Acceptance Evidence

- `pnpm check`: 164 test files, 1,370 tests passed; typecheck passed; lint passed with 0 errors and 6 pre-existing warnings.
- `CI=true pnpm e2e`: 39 passed, 22 explicitly skipped opt-in/superseded suites; exit 0. Business replay hash matched before/after; T16 Golden Story passed on desktop, narrow viewport and keyboard focus.
- `pnpm eval:t16` with configured `deepseek-v4-flash`: S1/S3 canonical-plus-four language variants and S24 five revision phrasings passed; safety evidence reported zero business mutations.
- Story routing governance maps every S1–S32 canonical story to deterministic and/or browser evidence; AI stories require at least four variants.
- Fastpath integration measured first usable Surface below 500 ms in the local PostgreSQL integration test, with zero LLM calls on user/Recipe hits.

## Review

Principal review found one High issue: Recipe generation/promotion existed, but the live Broker still fell directly to generic rendering and shared promotion was process-local. Commit `3bedb27` added exact slot instantiation, Recipe-before-generic resolution and durable human-promotion replay. Focused and full suites passed after the fix. No Critical or High findings remain.

The engineering and user-facing browser rubric are both at least 4/5 for hierarchy, readability, task focus, action clarity, narrow-screen behavior and recovery feedback.
