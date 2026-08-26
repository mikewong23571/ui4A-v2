# T27 mothership acceptance evidence — 2026-08-26

## Verdict

PASS for the T27 workstation-site scope on the deployed mothership environment.

- Public origin: `https://ui4a.mothership.internal:32067`
- Final UI4A source: `e3b282c60414da3da6b2f8beb54fecdc273ad0b4`
- Final Helm release: `ui4a`, namespace `ui4a-system`, revision `47`, status `deployed`
- Mothership overlay repository base SHA: `d01896e42b444c93726ff14d97d304fe15d76e7a`
- Overlay files remained operator-owned uncommitted state; their accepted checksums are:
  - `values-mothership.yaml`: `b48edc9fa94427298174520b657597bba6f22d220c0e59d94bc1701353f1f86a`
  - `image-release.json`: `eb8659f3647973154b1458f011c96e49011ff159734b25b90226fa728a7aea9f`

The verdict is based on revision 47. Revisions 44–46 were rejected during live acceptance and are
recorded below; local development servers were not used as final acceptance evidence.

## Immutable image provenance

All three images carry OCI version `0.1.0-experimental.1`, revision
`e3b282c60414da3da6b2f8beb54fecdc273ad0b4`, and build date `2026-08-26T21:17:41Z`.

| Component | Archive SHA-256 | Imported manifest / immutable digest |
| --- | --- | --- |
| Web | `7db4082407cfa159f79a407e16a30ba1e19af82d7ec8fd9636445e32a1fa851c` | `sha256:80c3302daa9c19f1f3c17f200f5ce3650c733c84e78693794574213c6c9fab56` |
| Worker | `cb7b23a71e2a3e9ec6ef696c2746df1d034a473f185fce8dae124bf0acb6a7e1` | `sha256:2fd512446082d6fb96c10373c99194c547144a1ef80532aa1cf9bf522dcf5047` |
| Runner | `1cc3cc46f16ac4349832d4e9e937aa6f1f0cb93bb4feaf2a014bcb77089279e1` | `sha256:a0c8af57c2e90f84cc3ec26a5082e68cf503359e0025b11ce08060af2caafb3f` |

The archives were checksum-verified before import on both `k8s-w-1` and `k8s-w-2`. Each node
resolved the same manifest digest and received the matching `docker.io/ui4a/<component>@sha256:*`
reference. The transfer archives were then removed from both nodes; the local evidence copies remain
under `/home/mike/.cache/ui4a-t27-evidence/`.

The configured Debian proxy returned HTTP 500 while building Runner and direct Debian egress was
blocked. Runner therefore reused the already verified `ui4a/runner:t24a1` system-tool layer
(`sha256:67c69a0110b63ed11a3971f97cf3d4746ef4b8ee5ca55460ec0b642f701b87d5`), while rebuilding
the application layer from the final SHA and replacing all release labels. The build revalidated
Git 2.39, Pandoc 2.17, and Codex SDK/CLI/platform 0.149.0.

## Deployment gates and integrity

The accepted overlay passed `verify-overlay.sh`. On `k8s-cp-1`, the staged exact-SHA chart passed:

1. `helm lint`;
2. full `helm template` rendering;
3. `templates/jobs.yaml | kubectl diff` with zero retained-Job diff;
4. `helm upgrade --dry-run=server --hide-secret`;
5. `helm upgrade --wait --wait-for-jobs --timeout 15m` without `--force`.

At revision 47:

- both worker nodes were `Ready` with `DiskPressure=False`;
- Web actual imageID was the accepted Web digest and Worker actual imageID was the accepted Worker
  digest; all application containers were ready;
- `/version` returned the final source SHA and build date;
- `/ready` returned `status=ready`; required bootstrap/config/migration/Postgres/replay dependencies
  were all `ok`;
- all retained Jobs remained `Complete` with no failures;
- total event log state was 453 rows at HWM 453 after acceptance activity;
- Deployment, StatefulSet, PVC and Secret UIDs were unchanged from the pre-upgrade capture:
  - Web Deployment `e04d3ca3-afca-4512-a5ee-731514dea138`
  - Worker Deployment `c836b2bd-e496-4f31-97e1-6ba3193e4a2b`
  - PostgreSQL StatefulSet `b2387c87-37b7-46ab-bbd0-c26f1f4a66a7`
  - PVCs `461c4d09-b404-4907-8631-c5a9d5b4e885`,
    `1908401a-4314-4842-bd7a-a51b40619ca4`,
    `cd0a9f99-534e-496f-b03e-611ed846a665`,
    `1262a91d-a50a-49a0-9f40-d0edbd8a647c`
  - runtime/Runner Secrets `1d5773fc-cbed-4176-996f-98f07c8b18a1`,
    `6f833480-1d13-4cad-b751-bb5203b009da`.

No PVC, PV, Secret or retained Job was deleted. `adminWorker` and `pkiRunner` image values were not
changed.

## Live T27 contract evidence

The browser used production Keycloak Authorization Code + PKCE. The password was read into process
memory from the cluster Secret and was neither printed nor written to a file.

- Home rendered exactly one `workspace:my-work` Sidecar Surface.
- The Sidecar root contained `waiting-for-me`, `in-motion`, and `work-lines` in declaration order.
- `inbox`, `delegations`, and `threads` all returned HTTP 200 and rendered the titles `在等我`,
  `在动`, and `我的工作线`; all three sitemap surfaces were `scope=principal`.
- Situation declared `site=workstation`, `scope=publishing`, `thread=t27-release`, and
  `focus=flow:article-drafting`; the four presence dimensions were posted and their corresponding
  `presence-*-changed` events were read back through `/api/events`.
- The workstation → meta bridge resolved to
  `/meta/flow/article-drafting?scope=publishing&thread=t27-release`; the meta → workstation bridge
  returned to `/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=t27-release`.
- Workstation home, workstation flow and meta flow exposed 16, 14 and 13 clickables respectively;
  the I3 audit found zero controls lacking `data-action` or `data-nav`.
- No raw mode appeared as a top-level navigation item.

Screenshots:

- `/home/mike/.cache/ui4a-t27-evidence/workstation-home-mothership-accepted.png`
  (`sha256:4c92a266090953da2ebd6ac03df46fb611609c8f54306483ddaa6772fcfd77f1`)
- `/home/mike/.cache/ui4a-t27-evidence/meta-flow-mothership-accepted.png`
  (`sha256:9a77a991603a80eb5c50fce75e2061cfc1bfc2218480caa2b859e9b4be7a588f`)

## CLI parity and invariants

The real built CLI obtained a memory-only production Bearer through a separate PKCE authorization
code exchange. Node used `/etc/ssl/certs/ca-certificates.crt`; TLS verification was not disabled.

- `doctor`: health/business/meta probes were all reachable with HTTP 200; selected scope was
  `publishing`.
- `entities get inbox|delegations|threads`: titles and counts matched the live browser entities
  exactly (`0/0/0` at the observation point).
- The Bearer was not emitted or persisted.

I5 used a read-only export pipeline: current core events were streamed without writing or printing
payloads into the exact-version engine and folded twice from an empty snapshot. Both folds produced
`sha256:0abdfa76553ea83bbc9ddf046964d5edea6993b15e519f1ce5f7509406998963` over 296 core
events (core HWM 374). Live `/ready` independently reported the required replay dependency `ok`.
The older bootstrap receipt (HWM 290) was explicitly identified as historical and was not presented
as a current fingerprint.

For I7, the live readiness result was intentionally honest: lifecycle was serving and required
dependencies were ready, while health remained degraded with `llm_not_checked` (plus other optional
unprobed dependencies). Under that degraded report the human renderer, OIDC, Sidecar, bridges and
CLI contract reads above all remained available with no business action submitted. Destructive
production LLM egress fault injection was not performed. The complete missing/failed/timeout model
and zero-business-side-effect matrix passed in the pre-deployment invariant suites.

## Pre-deployment gates

- `pnpm check`: 378 test files passed, 6 conditional skips; 2908 tests passed, 10 conditional skips.
- `CI=true pnpm e2e invariants`: 4 passed, 2 documented skips.
- `CI=true pnpm e2e`: 42 passed, 27 environment-conditional skips, 0 failed.
- T27 standing E2E (`workstation-home`, `workstation-situation`, `workstation-bridges`): 3/3 passed
  on the final source.
- Production Web image build, TypeScript build, and exact-SHA OCI label checks passed.

## Rejected live candidates and recovery evidence

- Revision 44 (`ef657aad`): rejected because `inbox` and `delegations` were not declared principal
  surfaces and returned `scope_insufficient` after real login.
- Revision 45 (`62a8e0c`): Home passed; rejected because scoped Canvas did not carry scope into
  Presentation/Sidecar requests.
- Revision 46 (`d893fd1`): Presentation carried scope; rejected because scoped entity-cache hydration
  still omitted it after a governance presence observation.
- During revision 46 rollout, accumulated transfer archives briefly triggered kubelet DiskPressure.
  Only the nine T27 `/tmp` OCI archives created by this acceptance were removed (recoverable from the
  local copies); both nodes automatically cleared the taint and Helm completed. No application data
  or Kubernetes authority object was removed.

Each rejected observation produced a TDD regression commit and git note before the next immutable
candidate was built. Revision 47 passed the same full live path end to end.
