# T59 Evidence

## Baseline
- Local/public SHA: 4e018fcb38a780fc6c1c0108786bb5de618e5cc2.
- Local dirty: only prior-turn UX report and five screenshots; preserved.
- `pnpm governance`: exit 0; exceptions/baselines empty.
- `ssh home ... ui4a-compose status`: 8 healthy; remote worktree clean.
- User instruction explicitly authorizes fixes and deployment. Conductor workflow autonomous review applies to engineering checkpoints, never human-only business approval.

## Red / Green and review
- F01/F02: missing message identity and Presentation detail Red; 8 files/53 tests Green. Common final authorized read enriches messages without a chat shadow snapshot; birth-pinned node titles remain data.
- F05/F08: 5 navigation Red cases and real drawer/main mismatch Red; 10 files/79 tests Green. Saved Sidecar member contract Red -> same id/new version Green; 4 files/29 tests.
- F03/F04/F06/F07: selection/stale choice/confirmation/required errors Red; 13 files/71 tests Green. Extra post-success-refresh regression retains success receipt.
- F09 transport: absent/invalid header 3 Red cases -> 6 files/56 tests Green. Proxy dropped supplied header; backup then provider-only dynamic forwarding made actual same-model request 400 -> 200.
- F09 history: lost failure structure + missing edit affordance Red; 5 files/29 tests Green. Recovery only restores preceding question to empty composer, never resubmits effects automatically.
- F10/F11: capture reset/missing edit/risk 4 Red plus terminal reachability Red; lifecycle/replay/born-version and bundle tests 2 files/9 Green.
- Independent review by navigation_cache: fixed accepted mutation becoming 503 if optional enrichment failed; committed receipt degrades material read only, required reads still error. Five files/24 tests Green.
- First full check saw 14 failures, including in-flight Red tests, stale confirmation wording and fingerprint behavior; second saw two existing behavior assertions (approval changes member actions, agent archive requires human). Corrected without weakening gates; focused 2 files/9 passed. Full final check pending.
- Confirm wording regressions: four files/21 tests Green; E2E assertions updated to local preflight truth.

## Provider environment change
- CLIProxyAPI only opencode-go headers now dynamically forward x-opencode-session and User-Agent. No model/base URL/credentials/other provider changes.
- Backup: aliyun-sz:/var/lib/cliproxyapi/config.yaml.before-t59-session-20260907T095843Z.bak. Current config SHA256 fb391df536aa684c2c3c0526a5b2e1016eb8898ee026b670b7a1e167aadba276. Automatic config watch applied; actual probe status200/model deepseek-v4-flash/reply present.
- Provider requirement verified at https://opencode.ai/docs/go/#where-can-i-use-it ; forwarding syntax verified from upstream internal/util/header_helpers.go.

## Live definition proposals
- CLI doctor failed CREDENTIAL_STORE_FAILED (Keychain); no credentials were extracted or saved. Used authorized browser Meta contract instead.
- todo-item v1 lifecycle revised to draft through its declared action; current runtime definitions/instances not rewritten. Full Governed Draft ac1569cfea8a9a2ad73d created ready.
- todo-capture Governed Draft f14d99d5d6da747847b9 created ready. Candidate adds reset plus explicit high retirement path to existing terminal; retirement not executed.
- Human-only activation remains pending. Born-version instances and existing capture singleton are not migrated automatically; no deployment success claim may imply these live behaviors changed.

## Published first candidate and live follow-up
- 1dfc0119920cd1e5f0d3923ddf85b628d889bd62 deployed successfully: preflight/up/status exit0, 8 healthy, public status contract passed. Three images exact SHA/digest; buildDate 2026-09-07T10:25:30Z.
- Original ux-review-2026 now displays real message excerpts, archived label in Chinese, all primary links retain thread; detail has full original text. No user original line mutation.
- New long message d5ad7cc9-c7e6-4dca-a39b-5c6c1074630d in bc67e5e2-6761-4855-81d9-bb0b81913de3 retains original newlines and final marker beyond 80-character summary. Actual LLM answered goal/status/material count2, distinguishing completion label from acceptance evidence. No explicit business action was requested/executed; normal user-message attachment remains logged.
- Drawer/main manual add-remove succeeds with count and member disappearance aligned. Main remove lists authorized readable choices; original idea untouched. Required field shows Chinese structural cue and folded raw validation. 390px page/chat has no horizontal overflow; 540px equivalent layout checked, not a claim of native200%.
- Live follow-up caught two additional gaps: new chat message attachment did not broadcast refresh; action hydration slice omitted target identity in confirmation. Fixed in 0230c8db12f5d8bd0b622e2d4a8018874c2d1b93 after meaningful Red/Green. Main rerun 7files/46tests; final full check 607passed/8skipped files, 4445passed/15skipped tests.
- UI4A E2E coverage: initial complete129 scenarios90passed/29skipped/8failed/2not-run. All eight failures were stale expected labels/status text. Affected19 rerun18passed+one stale remaining assertion; last deprecation1passed. Combined coverage100 passed/29 skipped; no claim that initial full command exited0. Initial and follow-up logs remain /tmp/t59-e2e*.log.
- Local production build passed; final OCI build provides production build against exact final commit. All actual service runs use isolated test database; no tests target deployment DB.
- Dedicated final live fixture thread:e7a2e50b-afe3-4561-ac67-90884e0ed43f created through UI; initial goal T59 发布复验：同步与阅读.

## Final release verification
- Final release0230c8db12f5d8bd0b622e2d4a8018874c2d1b93; buildDate2026-09-07T10:39:18Z. Exact digests recorded in DEPLOYMENT.local.md; preflight/up/status all exit0;8healthy. Retained volume hash unchanged.
- Public /live,/version=0230c8db; anonymous UI307/API401/account302; OIDC200.
- Final live new conversation d334af87: session acceptance changed thread e7a2e50b material count0→1 immediately; main member link appeared without reload; real LLM answered target+count1 in one sentence. Message5f1b31ae-2174-45ea-83d5-a4b3777635c3 remains as evidence. Fixture completed afterward; no archive executed.
- Confirmation preview now reads 操作对象：T59 发布复验：同步与阅读 plus declared irreversible impact. Cancel preserves state. Screenshots final-confirmation.png/final-chat-sync.png.
- Current final check607files passed/8skipped,4445tests passed/15skipped; typecheck/lint/strict included.
- Deployment runbook synchronized to home; both SHA2566579d067974e98dc38f6c01e563de40dc8e49e625cf4f3854320db682b4c3bac.
- Fresh final browser reads confirm both definition Drafts remain pending-approval. Never approved through automation. T59 remains open for governed definition adoption and existing-instance boundary; production code deployment is completed.
