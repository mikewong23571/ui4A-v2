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
