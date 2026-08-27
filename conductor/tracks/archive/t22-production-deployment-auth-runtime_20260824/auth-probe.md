# T22 Disposable Keycloak Authentication Probe

## Outcome

Keycloak 26.7.1 can provide UI4A's stable authentication primitives:

- browser Authorization Code + S256 PKCE;
- confidential client credentials;
- supported RFC 8693 internal-to-internal Standard Token Exchange;
- expected rejection when a public client attempts token exchange.

Keycloak's delegation extension is usable only as an experimental pre-authorization input. It does
not directly produce the final `act` chain expected by UI4A audit.

The probe ran against an official Keycloak 26.7.1 distribution in a temporary directory with H2 and
`start-dev`. It was not a production topology test. The dedicated realm was deleted after each run
and Keycloak shut down gracefully.

## Pinned inputs

| Input | Value |
|---|---|
| Keycloak | 26.7.1 |
| Official container manifest | `sha256:f1f1f01e472c8a78df40d8f2a49a925274eda4d3d80d5f6edbb5c880ee3c01c6` |
| Official distribution | `sha256:d3bb3da0e4bf574db0c857f92b272da90575dc97aa26c41329c9d4399200974c` |
| Delegation features | `token-exchange-delegation:v1`, `parameterized-scopes:v1` |
| Browser | system Google Chrome through Playwright |

No Token, password, client secret, Cookie, authorization code, or private key is stored in the
report. Probe user passwords and client secrets are generated at runtime.

## Verified flows

### Authorization Code + PKCE

The probe created a public `ui4a-web` client requiring S256 PKCE, launched real headless Chrome,
authenticated a realm user, accepted consent, captured the redirect code, and exchanged the code
with its verifier.

Verified:

- state round trip;
- S256 challenge/verifier;
- expected human subject;
- expected agent audience;
- no client secret on the public client.

### Client Credentials

A confidential `ui4a-agent` client obtained a service token. The decoded, unpersisted claims
identified `ui4a-agent` as the authorized party.

### Standard Token Exchange

The browser token included `ui4a-agent` in its audience. The confidential agent client then
performed the RFC 8693 access-token exchange.

Verified:

- HTTP success and standard issued token shape;
- exchanged `sub` remained the human subject;
- exchanged `azp` identified the agent client;
- public `ui4a-web` exchange was rejected.

Keycloak Standard Token Exchange is supported, enabled by default at the server feature level, and
must additionally be enabled on the confidential requester client.

## Delegation and the act boundary

Official Keycloak documentation marks Token Exchange Delegation as experimental. The live probe
confirmed this two-step behavior:

1. A human authorizes `scope=openid delegation:probe-actor` on a consent-required client.
2. The resulting access token contains `may_act.sub`, proving the named actor was pre-authorized.

The actor had Keycloak's `realm-management/impersonation` role as required. A subsequent Standard
Token Exchange succeeded and preserved the human `sub` plus agent client `azp`, but the exchanged
token contained neither `act` nor `may_act`.

Consequences:

- UI4A must not claim Keycloak directly emits a stable JWT `act` chain.
- The stable machine identity is the verified exchanged pair: human `sub` + agent client `azp`.
- UI4A may project that pair into its canonical delegation/audit chain.
- Optional `may_act` can be consumed only behind an explicit experimental profile.
- Human-only approval remains an application judgment; Istio or token exchange cannot infer it.
- A custom Keycloak SPI solely to manufacture `act` is not justified by this probe.

## Istio versus application authorization

Istio should enforce:

- trusted issuer, signature and intended audience;
- token presence on protected routes;
- coarse service/path policy;
- network identity between workloads.

UI4A must enforce:

- actor/principal/scope derivation;
- `sub` + `azp` delegation interpretation and optional `may_act`;
- human-only approval;
- current Siren action, Cedar policy, guards and schema;
- event provenance and replay.

An Istio-validated request is authenticated transport input, not an approved UI4A action.

## Image distribution finding

The internal `docker-quay` Nexus repository returned HTTP 200 and the pinned manifest digest.
However, live `ctr` resolution rewrote the HTTP API root to HTTPS; the HTTPS repository returned
HTTP 400, including with `--plain-http` and a disposable `override_path` hosts directory.

The probe therefore used the official signed release artifact rather than changing node-level
containerd configuration. Phase H must solve immutable Keycloak image import separately; this probe
does not treat manifest reachability as a pullable image.

## Sources

- [Keycloak downloads](https://www.keycloak.org/downloads)
- [Running Keycloak in a container](https://www.keycloak.org/server/containers)
- [Configuring and using token exchange](https://www.keycloak.org/securing-apps/token-exchange)
- [Specifications implemented](https://www.keycloak.org/securing-apps/specifications)

The executable disposable probe is [scripts/t22-keycloak-probe.ts](../../../scripts/t22-keycloak-probe.ts).
Machine-readable results are in [auth-probe.json](./auth-probe.json).
