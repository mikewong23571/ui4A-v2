# T22 Technical Stories

> Technical stories route user outcomes to the narrowest mechanical boundary. Each story starts
> with a failing test or probe, preserves UI4A's single event truth, and does not treat deployment
> success as product acceptance.

## TS1 Unified deployment configuration

Given the same logical deployment settings, Compose environment variables and Helm values must
resolve to the same typed runtime configuration. Production mode fails closed for missing identity,
database, Temporal, TLS, or Runtime Backend settings and never falls back to localhost/demo values.

Red evidence: config parser fixtures for missing, malformed, contradictory, and request-overridden
settings.

## TS2 Reproducible OCI artifacts

Web, Worker, and Runner images originate from one Git SHA and expose immutable version metadata.
Worker gains a production build/start path. Images run non-root, declare writable paths, contain no
local secrets, and produce SBOM and vulnerability evidence.

Red evidence: Dockerfile/image contract tests before images exist.

## TS3 Credential-derived request identity

OIDC/JWT verification derives actor, principal, scope, audience, expiry, and delegation provenance.
Production routes reject request body/query/header identity overrides. Demo identity remains an
explicit local-only adapter.

Red evidence: injected JWT/JWKS corpus covering valid and invalid claims without a live IdP.

## TS4 Browser, CLI and delegated identity

Browser Authorization Code + PKCE, CLI Bearer credentials, service accounts, and RFC 8693 Token
Exchange converge on the same request identity. The `act` chain can only narrow authority and
cannot confer human approval.

Red evidence: protocol fixtures plus live disposable Keycloak probe before product wiring.

## TS5 Versioned database migration

Schema creation leaves request-time boot and becomes an idempotent, locked, versioned command.
Migration and runtime roles are distinct; incompatible or failed migrations keep workloads unready.

Red evidence: empty/existing/concurrent/partial-failure database integration tests.

## TS6 Cross-replica single atom

Two Web processes judging the same resource serialize refresh, judgment, append, and projection at
the PostgreSQL boundary. The existing declaration → guard → schema order and rejection events remain
unchanged.

Red evidence: two isolated service runtimes demonstrate the stale-judgment failure before locking.

## TS7 Honest health and readiness

Liveness reports process life; readiness reports whether the process can safely serve its declared
role. Dependency status separately reports PostgreSQL, migrations, Temporal, Keycloak/JWKS, LLM, and
Runtime Backends. A degraded dependency never produces Ready by HTTP status alone.

Red evidence: dependency matrix with injected timeouts and failures.

## TS8 Production Temporal adapter

Temporal address, namespace, task queue, identity, connection options, and drain behavior are
deployment data. Workflow history remains durable execution history, not business truth.

Red evidence: configuration tests and disposable restart/drain probe.

## TS9 Stateful services and recovery

PostgreSQL 17 persists UI4A and Keycloak data; Temporal uses PostgreSQL persistence. Backup artifacts
are named, checksummed, versioned, and restored into an isolated target before business replay hashes
are compared.

Red evidence: restore harness starts with missing backup metadata and deliberately divergent hashes.

## TS10 Runtime Backend SPI

A server-owned SPI carries immutable Agent Run birth references through prepare, execute, collect,
verify, and finalize. Backend, image, cwd, provider, model, environment, and grants are absent from
user-controlled task schemas.

Red evidence: schema and source-governance tests reject every deployment override.

## TS11 Kubernetes Job Runtime

Each authorized Run receives a fixed Job/Pod identity, image, ServiceAccount, resources, network
policy, workspace, cancellation, and retention policy. Pod eviction or Worker restart yields recovery
or an honest auditable terminal result.

Red evidence: fake Kubernetes API lifecycle tests followed by a disposable live Job probe.

## TS12 Trusted Host Runner

The same Runner artifact can operate as a registered host daemon with fixed capability/profile/root
grants. Heartbeats, leases, disconnects, cancellation, duplicate delivery, and result ingress are
idempotent and authenticated.

Red evidence: in-process fake Runner transport and lease-expiry tests.

## TS13 Compose all-in-one

Compose starts PostgreSQL, Temporal, Keycloak, migrations, Web, Worker, and container Runner with
named volumes and dependency-aware health. Restart preserves data. Destructive cleanup is separate
and explicit.

Red evidence: rendered Compose contract and clean-environment acceptance test.

## TS14 Kubernetes and Istio deployment

A generic chart plus mothership values renders valid namespace, RBAC, ServiceAccount, static
PV/PVC, Jobs, probes, resources, PDB, Services, Gateway, VirtualService, RequestAuthentication, and
AuthorizationPolicy objects. Images use pinned digests and `IfNotPresent`.

Red evidence: schema/render tests before applying to the live cluster.

## TS15 Internal TLS

Two internal hostnames receive leaf certificates from a persistent experimental CA. Repeated deploys
reuse the CA and validate SAN, issuer, chain, Istio credential, OIDC issuer, redirect, and logout.

Red evidence: temporary PKI fixtures and wrong-host/wrong-chain tests.

## TS16 Shared story corpus

Compose and Kubernetes execute the same identity, judgment, Runtime, audit, and recovery assertions.
Environment topology can differ; business and authorization outcomes cannot.

Red evidence: every U1–U17 route begins in `acceptance-baseline.json` with status `red`.

## TS17 Experimental release provenance

`v0.1.0-experimental.1` binds Git tag, image digests, checksums, SBOM, release notes, known limits,
upgrade/rollback evidence, and both environment reports. It never claims GA, SLA, LTS, or unverified
HA.

Red evidence: release manifest validation fails until every required artifact and acceptance report
exists.
