# T28 mothership acceptance evidence — 2026-08-26

## Verdict

PASS for T28 first-class interaction on the deployed mothership environment.

- Public origin: `https://ui4a.mothership.internal:32067`
- Accepted UI4A source: `2d8d6c860c39248866242018dcb9336a289753e6`
- Accepted Helm release: `ui4a`, namespace `ui4a-system`, revision `49`, status `deployed`
- Mothership overlay base SHA: `d01896e42b444c93726ff14d97d304fe15d76e7a`
- Operator-owned overlay remained uncommitted. Accepted checksums:
  - `values-mothership.yaml`: `35eaa80faa3ca021f3de4c369a26f818fa3f05c4ba0de6848327ecde8caae9b5`
  - `image-release.json`: `6deae88891cc2d54f493a7b315ae2fae271dee727a620ba6d1915174a513ad08`

Revision 48 is rejected evidence. The first live I3 audit found that the local raw-drawer close
control lacked `data-nav`; regression commit `2d8d6c8` fixed it before rebuilding and deploying
revision 49. No business action was submitted during the rejected audit.

## Immutable image provenance

All accepted images carry OCI version `0.1.0-experimental.1`, revision
`2d8d6c860c39248866242018dcb9336a289753e6`, and build date `2026-08-26T23:06:00Z`.

| Component | Archive SHA-256 | Imported manifest / immutable digest |
| --- | --- | --- |
| Web | `f05c3e8ac84311ba7a999fee6467cdec4af4db07b5a03e048556e19384608d65` | `sha256:80ab597a2c7d58e1f14f0cb95453896ed705daddeefce61abe8882ff3ec34d12` |
| Worker | `1d8b2d1c4d7fd1dcf1484df667ab9b450999f502e2b652000e6bb19edce67e9f` | `sha256:8b4a9addfc84c3111292fd55d556066d9760725b96fee0746d9e9361cf83deb0` |
| Runner | `cd9c73e23b32b748be80c0989c23bc5a156d154306dbe2d71e518e97ccc3d200` | `sha256:fc34361dcbab96a80607b017d47161abc73162aca897c321c6707a03ff215a7b` |

The Web image was built from the detached accepted-source worktree. The accepted-source delta after
revision 48 changed only Web raw UI and E2E organization; a scoped Git diff proved zero changes in
Worker/Runner and their package inputs. Worker therefore reused the already source-built T28 runtime
and replaced exact release metadata. Runner likewise reused the verified Git 2.39 / Pandoc 2.17 /
Codex 0.149 runtime and replaced release metadata. Both still resolve content-addressed parent
digests, and all three final labels were inspected before export.

Each archive checksum was verified before import on `k8s-w-1` and `k8s-w-2`; both nodes produced the
same component manifest digest and received its immutable `docker.io/ui4a/<component>@sha256:*`
reference. The twelve rejected/accepted transfer archives were then removed by exact path from both
nodes; evidence copies remain under `/home/mike/.cache/ui4a-t28-evidence/`.

## Deployment integrity

The accepted overlay passed `verify-overlay.sh`. The staged chart passed `helm lint`, full template,
zero retained-Job diff, and server dry-run with secrets hidden. Revision 49 used ordinary
`helm upgrade --wait --wait-for-jobs --timeout 15m`, never `--force`.

- all three nodes were `Ready` and `DiskPressure=False`;
- Web and Worker were ready with actual imageIDs equal to the accepted immutable digests;
- `/version` returned the accepted SHA/build date;
- internal `/ready` returned `status=ready`; bootstrap/config/migration/Postgres/replay were `ok`;
  optional Keycloak/LLM/Runtime/Temporal probes remained honestly `unknown`, so health was degraded;
- all retained Helm Jobs remained complete with zero failures;
- event log state after acceptance was 471 events at HWM 471;
- Deployment, StatefulSet, PVC and Secret UIDs were unchanged from revision 47:
  - Web Deployment `e04d3ca3-afca-4512-a5ee-731514dea138`
  - Worker Deployment `c836b2bd-e496-4f31-97e1-6ba3193e4a2b`
  - PostgreSQL StatefulSet `b2387c87-37b7-46ab-bbd0-c26f1f4a66a7`
  - PVCs `461c4d09-b404-4907-8631-c5a9d5b4e885`,
    `1908401a-4314-4842-bd7a-a51b40619ca4`,
    `cd0a9f99-534e-496f-b03e-611ed846a665`, and
    `1262a91d-a50a-49a0-9f40-d0edbd8a647c`
  - runtime/Runner Secrets `1d5773fc-cbed-4176-996f-98f07c8b18a1`,
    `6f833480-1d13-4cad-b751-bb5203b009da`

No PVC, PV, Secret or retained Job was deleted. `adminWorker` and `pkiRunner` image values were
unchanged.

## Live T28 contract evidence

The live browser used production Keycloak Authorization Code + PKCE. The password remained in
process memory and was neither printed nor written to a file.

- **Intent crop:** the one `workspace:my-work` Surface kept its three declaration regions. Their
  exact property bindings were:
  - `waiting-for-me`: `properties.count`, `properties.delivered`, `properties.title`
  - `in-motion`: `properties.count`, `properties.title`
  - `work-lines`: `properties.count`, `properties.title`
  The exact built-in intents therefore produced distinct, bounded property subsets rather than the
  former all-property fallback.
- **First-class actions:** `article-drafting:main` declared `abandon` and `next`; Entity and Canvas
  rendered exactly that action-name set through the shared action group. The visible group legend
  stated that human and Assistant use the same contract and judgment. No action was executed.
- **Structured citation:** a synthetic canonical final SSE frame, injected only at the browser
  transport boundary, supplied `FactRef{rel:'article-drafting:main',pointer:'/properties/node'}`.
  The deployed UI rendered one citation chip, ignored the `post:ghost` prose decoy, preserved
  `scope=publishing&thread=t28-live`, focused the same Canvas entity, and set `aria-current` from the
  URL focus.
- **Raw lens:** Entity and citation-focused Canvas each opened the local raw drawer in two steps.
  Parsed JSON was deep-equal to the fresh authorized Siren response. The `workspace:*` home raw
  trigger was disabled, so no virtual business contract was invented. Raw remained absent from the
  top navigation.
- **Diagnostics and I3:** the first screen exposed zero diagnostic mechanism codes. Full clickable
  audits found 17 Home, 18 Entity and 28 Canvas controls, with zero missing `data-action`/`data-nav`.

Screenshot:

- `/home/mike/.cache/ui4a-t28-evidence/first-class-interaction-mothership.png`
  (`sha256:907c5e1d345645262dc98813c2109c02fd452ece16bbed2cd3d2f81cc36b26eb`)

## CLI parity and replay

The built CLI obtained a memory-only Bearer through a separate PKCE exchange with system CA trust.
`doctor` reported health/business/meta HTTP 200 under `publishing`. `entities get
inbox|delegations|threads` returned the same titles and counts as the browser (`在等我/在动/我的工作线`,
all count 0). The token was not emitted or persisted.

The read-only event export streamed current core events directly into the exact-version Engine fold;
event payloads were never emitted as evidence. Two folds from an empty snapshot produced the same
`sha256:0abdfa76553ea83bbc9ddf046964d5edea6993b15e519f1ce5f7509406998963`
over 296 core events at core HWM 374. The bootstrap receipt is historical and was not represented as
the current fingerprint. Live readiness independently reported replay `ok`.

## Pre-deployment gates

- Accepted source `pnpm check`: 386 test files passed, 6 conditional skips; 2941 tests passed,
  10 conditional skips; governance passed.
- `CI=true pnpm e2e invariants`: 4 passed, 2 documented standing skips.
- Accepted source `CI=true pnpm e2e`: 44 passed, 27 environment-conditional skips.
- Rejected-live regression before rebuild: raw component 3/3 and citation/raw + full-page I3 3/3.

The mothership browser/CLI/replay evidence, rather than a local dev server, is the final Track
acceptance authority.
