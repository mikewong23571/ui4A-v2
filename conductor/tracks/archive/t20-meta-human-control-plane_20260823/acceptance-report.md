# T20 Acceptance Report

## Outcome

U1-U22 and all four Golden Stories pass under the autonomous acceptance protocol in
`conductor/workflow.md`. Mechanical Safety is 100%. The control plane remains deterministic and
does not add an AI, state store, event family, database table, router or UI dependency.

## User-story matrix

| Story | Result | Primary evidence |
|---|---|---|
| U1 | Pass | Dashboard projects seven top-level sitemap descriptors; synthetic `meta/widgets` appears without a dashboard branch. |
| U2 | Pass | Server allowlist resolves requested/effective scope; URL restores it; unknown scope returns 403. UI labels local identity honestly. |
| U3 | Pass | Bounded authorized collection summaries index name, intent, type, status and rel; query/filter are URL state; pending/invalid are one-click filters. |
| U4 | Pass | Task-first heading, status, intent, relationships and next steps precede raw contract in every specialization. |
| U5 | Pass | Six slim Application summaries expose title, intent, version and relationship counts with zero member exact fetch. |
| U6 | Pass | Application view separates intent, Flows, Capabilities, Policies and provenance. |
| U7 | Pass | Application projection emits Flow/Capability links; generic link resolver preserves exact rel and scope. |
| U8 | Pass | No Application action means explicit read-only view; no create/edit/activate control is invented. |
| U9 | Pass | Agent Definition list/exact reads use one effective scope and owner; forged/other scope identities remain absent. |
| U10 | Pass | Prompt, Task/Result, runtime, tool/resource/artifact and Eval sections render mechanically. |
| U11 | Pass | Sealed authority, typed bindings and deployment requirements are distinct; secret-shaped raw values are redacted. |
| U12 | Pass | Agent Runs link the exact birth Definition ref; existing T19 activation/replay tests prove old Run refs do not drift. |
| U13 | Pass | Draft summaries include owner, scope, kind, target, status, version and expiry and participate in status search/filter. |
| U14 | Pass | Invalid issues drive an issue-root-focused structured RJSF editor; revise preserves unrelated roots, supports deletion, and uses current action/version/CAS IDs. |
| U15 | Pass | Diff, failure-first checks, Eval, sources, provenance and raw audit are one deterministic review surface. |
| U16 | Pass | Pending Draft loads its activation actions; reject reason remains required; current action is reread; existing atomic/CAS/agent-denial suites pass. |
| U17 | Pass | Source links and T19 Authoring callback tests cover success→Draft, invalid revision, failure→zero Draft and human-only activation. |
| U18 | Pass | URL restores rel/scope/query/filter; loading, missing, unauthorized, network and partial-summary states preserve the review route. Replay suites pass. |
| U19 | Pass | Unknown legal collection/detail renders generic facts, links, declared actions and redacted raw contract; specialization wins by class priority. |
| U20 | Pass | Source governance removes `FACES`, browser identity fields and callbacks; generic/future/pending action fuzz and every Meta submit reread pass. |
| U21 | Pass | Desktop/mobile browser matrix, visible focus, semantic headings/regions, local overflow, 390 px page-width and keyboard-only approval pass. |
| U22 | Pass | Autonomous renderer walkthrough met the 30/60/90-second budgets with no raw dependency or Critical/High finding, per workflow substitution. |

## Golden Stories

| Story | Budget/result | Evidence |
|---|---|---|
| Application orientation | 30 s / pass | One direct collection→Application path, purpose/Flow/Capability visible above raw; Playwright 0.36 s automation proxy. |
| Agent permission explanation | 60 s / pass | Authority/binding/runtime/tools/resources/Eval/birth links on one page; Playwright 0.35 s proxy. |
| Draft governance | 90 s / pass | Invalid workbench plus T17/T19 revise/submit/agent-denial/human-activation integration evidence; no raw dependency. |
| Future surface | pass | Intercepted `meta/widgets` fixture is discovered and generically rendered; zero declared actions means zero controls. |

## Mechanical Safety

All eight failure conditions in `evidence.md` pass: no hardcoded inventory; no unknown-scope widening;
no undeclared/current-action bypass; no callback/identity/provider secret exposure; no Agent approval or
half activation; no unknown-class white screen; replay facts/links remain stable; mobile and keyboard
decision paths remain usable.

## Verification snapshot

- `pnpm check`: 238 test files passed, 3 skipped; 1635 tests passed, 3 skipped; typecheck/lint passed.
- `CI=true pnpm e2e`: 43 passed, 29 environment-gated skipped, 0 failed.
- T20 focused Playwright: 8/8 passed.
- Warm local 20-run Application detail: p50 67 ms, p95 77 ms; target p95 < 1000 ms.
- Live milestone: `/api/health` reports app/db ok; Meta sitemap reports 7 faces in governance;
  Temporal UI returns 200 and Worker is RUNNING.

## Visual evidence

Tracked under `screenshots/`: dashboard, Application and Agent Definition at 1440×900 and 390×844,
plus invalid Draft and unauthorized states. Visual QA found no page-level overflow or Critical/High issue.
