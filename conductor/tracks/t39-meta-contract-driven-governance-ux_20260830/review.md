# T39 Final Review

Date: 2026-08-31 (Asia/Singapore)

## Outcome

T39 is accepted against `product-vision.md`: the human experience is a projection of the same
Siren entities, links, actions, guards, schemas and bounded cognitive declarations consumed by the
CLI and Assistant. The result does not introduce per-Application pages, a fixed Meta inventory,
visual directives in definitions, or a second authority path.

US1–US18 pass. US19 passes with one explicit observation: shared-context, FactRef, prompt-budget
and honest-failure evidence pass, but the opt-in real-provider Eval was **NOT RUN** because no
provider environment was configured. Twelve real-LLM cases were skipped; no scripted or rule
driver was substituted.

## Root browser acceptance

The orchestrator personally repeated the final browser checks with `agent-browser`; subagent
captures were used only as supporting evidence.

- At 390×844, `/meta` rendered the canonical definition console with
  `scrollWidth === innerWidth === 390` and no functional control outside the viewport.
- `/` rendered seven declaration-ordered business Applications with title and intent. `default`
  remained discoverable by contract/CLI but was excluded from the shelf by `system-fallback`, not
  by a React name check.
- The orchestrator opened all eight Application lenses. Every page had document width 390. The
  seven business landings showed their declared Application title and task regions; direct
  `default` audit showed only the fallback/error-safe landing rather than a mixed business page.
- Publishing showed `内容发布 / 文章 / 文章发布向导`; community showed `社区互动 / 评论` with
  decision actions; development/editorial/governance each exposed one primary task action; todo
  and ideas retained their capture identity. No functional button rectangle crossed the viewport.
- In an isolated database, a real CLI-created Draft at 390px showed Validation, Mechanical diff,
  Checks, Evaluation, Sources & provenance and only current Siren actions. Page width remained
  390; the decision surface did not obscure the diff.
- Submitting that Draft produced a real pending Activation. Its 390px page showed the target,
  candidate version, validation, Draft relation and human-only Approve/Reject actions without
  `requested-by` leakage or horizontal overflow.
- A missing canonical Meta rel preserved the complete URL and current view while rendering a
  neutral, actionable not-found state.
- During the first direct run, `127.0.0.1` was rejected by Next dev-origin protection and an old
  browser session stalled. Repeating on canonical `localhost` with a fresh server passed; this was
  a test-environment/session issue, not a product-page failure.

Supporting visual inventory (transient audit artifacts, summarized here before workspace cleanup):

- Meta/Dashboard: `.artifacts/t39/phase-d/us1-fix1-meta-mobile.png`
- Draft: `.artifacts/t39/phase-e/us3-stale-390-fixed.png`
- Activation: `.artifacts/t39/phase-f/us9-r2-deduplicated-mobile-390.png`
- Application shelf: `.artifacts/t39/phase-g/g17-browser/us11-shelf-390.png`
- Installed landings: `.artifacts/t39/phase-g/g17-browser/*-390.png`
- Future fixture: `.artifacts/t39/phase-g/g17-fix1/future-landing-final-390.png`

## CLI and contract parity

The globally installed `ui4a` command was absent, so the repository-owned reference client was
built and executed as `node apps/cli/dist/main.js`; no curl/direct-database contract substitute was
used.

- `doctor` reached health, business and Meta endpoints and reported the local-demo identity
  honestly.
- `apps list` returned eight installed Applications: one fallback plus seven business entries.
- `application:publishing` exposed title, intent, structured `entry.role/target`, self/entry links
  and no invented actions.
- `flow:article-drafting` resolved to the live instance with declared presentation fields,
  collection link and the current `next`/`abandon` action schemas.
- `actions list` matched the exact entity action names, methods, hrefs and JSON Schemas. Pixel,
  responsive, density and sticky policy did not enter the machine contract.

## User-story verdicts

| Story | Verdict | Final evidence |
| --- | --- | --- |
| US1 Meta responsibility-first home | PASS | Trait/Hint-driven grouping, pending/exception emphasis, 390px root browser audit |
| US2 canonical Application → Flow | PASS | Canonical route, title/topology/ready gate and bridge E2E |
| US3 governed Draft review | PASS | Isolated ready/invalid/stale evidence, root 390px Draft audit, staged Siren actions |
| US4 attention is not authority | PASS | D51 wording, URL preservation, grant-union tests and E2E |
| US5 declared Application overview | PASS | Generic overview projection, desktop/mobile collection evidence, future member tests |
| US6 Activation decision | PASS | Isolated pending Activation audit, staged high-risk confirmation and human-only E2E |
| US7 task-language relationships | PASS | titled canonical relationships, self demotion and fallback-rel tests |
| US8 unknown Meta surface | PASS | future Meta fixtures, generic renderer and invalid-Hint fail-closed tests |
| US9 keyboard/responsive/recovery | PASS | focus restoration, raw disclosure, local overflow, 404/CAS recovery and 390px audit |
| US10 non-traditional dual-door | PASS | D54 governance, source scans, CLI parity, full checks/E2E |
| US11 Application shelf | PASS | seven business entries, default trait exclusion, title/intent at 390px |
| US12 publishing product/create balance | PASS | output catalog + one primary-create region, responsive member layout |
| US13 community decision facts | PASS | declared body overview adjacent to approve/reject, no default ownership leak |
| US14 development/editorial dedupe | PASS | canonical-rel dedupe and one primary action per landing |
| US15 governance business-to-Meta bridge | PASS | business authoring entry, explicit Meta bridge, entry invariant |
| US16 todo/ideas capture identity | PASS | stable surface headings, semantic empty states and one capture CTA |
| US17 default fallback only | PASS | absent from shelf, direct audit safe, ownership invariants |
| US18 eight plus future ninth | PASS | root eight-lens sweep, fixture-only ninth Application and source scan |
| US19 Assistant shared attention | PASS WITH OBSERVATION | parity/sanitizer/FactRef/prompt tests pass; real LLM Eval NOT RUN |

## Genericity and Product Vision audit

- `check-d54` scanned five bundles and 43 generic runtime files with zero violations.
- Production scans found no installed Application-name or business-rel/action branching in the
  generic Application/Presentation/renderer paths; matches for `default` were ordinary component
  variants only.
- Bundle scans found no CSS, layout, device, breakpoint, width, sticky, grid or table keys.
- A ninth `research` fixture gained shelf membership, landing, entry, collection, semantic empty
  state and 390px behavior from data alone.
- Final provider requests retained only the closed V1 cognitive projection. Maximum measured wire
  request was 14,392 UTF-8 bytes, below the 32,768-byte hard limit.
- All functional controls remain current-action or explicit-navigation backed. Final I3 E2E also
  caught and fixed missing `data-nav` on generic Meta relationship/member/page links.

## Final verification

- `pnpm format:check`: pass after transient evidence cleanup.
- `pnpm governance:strict`: pass; empty baselines; D54 and canonical Meta route checks pass.
- `CI=true UI4A_WORKER_HEALTH_PORT=3199 pnpm check`: 456 test files passed / 4 skipped;
  3,475 tests passed / 6 skipped; typecheck and ESLint completed with zero errors.
- `CI=true UI4A_WORKER_HEALTH_PORT=3199 pnpm e2e`: 55 passed / 22 environment-gated skipped.
- `CI=true UI4A_WORKER_HEALTH_PORT=3199 pnpm e2e invariants`: 19 passed / 8 gated skipped.
- Prompt-budget focused suite: 56 tests passed; measured wire requests 14,318–14,392 bytes.
- `pnpm eval:llm`: exit 0; 12 real-provider cases skipped because provider env was unset.

## Remaining observations

- US19 should be rerun when a real provider profile is deliberately supplied. This is not replaced
  by mock evidence and does not weaken the honest-failure contract.
- Existing ESLint warnings remain outside T39; final lint had zero errors.
- The transient screenshot and Playwright output directories are removed at Track closure after
  their DOM/visual facts are recorded above.
