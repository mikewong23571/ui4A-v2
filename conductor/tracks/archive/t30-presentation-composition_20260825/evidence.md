# T30 Acceptance and Deployment Evidence

Date: 2026-08-26 UTC

Source revision: `eb1b02eff08a098db25bb14f443e1713d1bbfe82`

## Automated acceptance

- `pnpm check`: 372 test files passed, 6 integration files skipped; 2889 tests
  passed, 10 skipped. Typecheck, ESLint (zero errors) and governance passed.
- Combined Playwright command for T16 Golden, T24 honesty, T30 composition and
  invariants: 9 passed, 2 superseded invariant cases skipped.
- T30 proof verifies the real Presentation HTTP route, one Canvas Surface with
  three ordered regions, binding hydration against fresh entity snapshots,
  Presentation projection rebuild and Business fold isolation.
- Independent Phase E review passed after the declared region-mode, Explain
  provenance and authorization-migration corrections.

## Immutable images and rollout

The local `pnpm dev:all` attempt proved Web startup but could not keep the full
stack running because this build host lacks the Temporal CLI. At the user's
direction, milestone runtime verification moved to the existing mothership
Kubernetes environment instead of weakening that dependency.

Images were built from the exact source revision with non-root runtime user and
matching OCI revision label, exported, checksum-verified, imported into both
workers and pinned by manifest digest:

| Image | Archive SHA-256 | Manifest digest |
| --- | --- | --- |
| `ui4a/web:t30-eb1b02e` | `0d63753e7539a9163d685fb8453325070183d7772046d17f45f7faa958befcab` | `sha256:149dcfb01fc705dfb836c0d9f65655a28e7e9576c2ff8d2418a2f1c788e91485` |
| `ui4a/worker:t30-eb1b02e` | `ae66f677828a2ae82e9caca67524e9ffb3e991b94ddb463e7f0763ed819570ad` | `sha256:6aa08e1fecbc6c6d02f0a4234c94d1d017ee35e55924f4a2167b5754ce78c3a5` |

Before rollout, database HWM 374 was exported as
`ui4a-pre-upgrade-eb1b02e-hwm374.dump`; SHA-256 is
`c4e07ba073a29388f13ac3c2189d94b66ee4d0c11e719223b15d6c22932d2f75`,
and `pg_restore -l` validated the archive catalog. Overlay verification, Helm
lint, retained Job zero-diff and server dry-run all passed.

Helm revision 43 is `deployed`. Web and Worker are 1/1 Ready on the digests
above. `/version` reports the exact source revision and `/ready` reports
`status=ready`. The six retained Job UIDs, four PVC UIDs and runtime Secret UID
are unchanged. No `--force`, storage deletion or retained Job replacement was
used.

The suspended legacy Backup CronJob fixture lacked a remote PostgreSQL target;
the one failed derived Job was deleted, and the verified stream backup above
was used. This does not change T30 product behavior or retained release Jobs.

## Installed CLI contract proof

The CLI was built, packed and installed into an isolated prefix. Authentication
used the canonical Keycloak Authorization Code + PKCE flow and the reviewed
public CA; access tokens remained in process memory and were not written to
evidence.

- `doctor`: Bearer auth configured; health, business and meta probes all HTTP
  200.
- `apps list` and `entities get threads`: successful authorized discovery and
  Siren reads.
- The same credential created `workspace:my-work` through the Presentation
  endpoint. Receipt was `ready`, Sidecar version 1.
- CLI `request get` read one `layout` root with ordered regions
  `waiting-for-me`, `in-motion`, `work-lines`; entity-contract dependencies are
  exactly `inbox`, `delegations`, `threads`; bindings contain no factual
  `value` fields.
- CLI Explain read `my-work@1`, all three regions available, with
  `composition:my-work@1` declaration provenance.
- CLI read of `/api/entity?rel=workspace:my-work` failed with exit 5 / HTTP 404,
  proving the virtual subject did not become a Business entity. CLI audit for
  that rel returned zero business events.

