# T22 Production-shaped Deployment Architecture

## Deployment topology

```text
internal browser / ui4a CLI / delegated agent
                    │ HTTPS + OIDC/JWT
                    ▼
           Istio ingressgateway
             ├── ui4a.mothership.internal
             └── auth.ui4a.mothership.internal
                    │
       ┌────────────┴────────────┐
       ▼                         ▼
 UI4A Web replicas          Keycloak 26.7.1
       │                         │
       ├── PostgreSQL atom       └── Keycloak database
       ├── Temporal client
       └── internal callback
                    │
                    ▼
              Temporal 1.31.2
                    │ task queue / namespace ui4a
                    ▼
               UI4A Worker
                ├── K8s Job → Agent Runner oneshot
                └── trusted host → Agent Runner daemon

 PostgreSQL 17 static local PV
   ├── ui4a
   ├── keycloak
   ├── temporal
   └── temporal_visibility
```

Compose uses the same images, logical databases, identity contracts, task queue/namespace semantics,
and story corpus. It replaces Kubernetes/Istio objects with Compose services, named volumes, and a
local TLS edge; it does not define a second application architecture.

## Identity trust line

Keycloak authenticates identities; UI4A governs actions.

- Browser: Authorization Code + S256 PKCE → secure UI4A session/request identity.
- CLI/service: verified Bearer Token with issuer, signature, audience, expiry and scopes.
- Agent: confidential-client Standard Token Exchange. Human subject is `sub`; agent client is
  `azp`.
- Canonical delegation audit is mechanically projected from verified `sub + azp + scopes/audience`.
- Keycloak experimental consent can add `may_act` before exchange, but the live probe showed
  exchange emits neither `act` nor `may_act`; it is optional experimental evidence, not the
  stable trust root.
- Human approval requires the credential class and application policy to identify a human. Request
  actor/principal fields never confer humanity.

Istio performs issuer/signature/audience and coarse route/network enforcement. UI4A still derives
identity and executes Siren/Cedar/guard/schema/CAS judgment. Proxy headers alone are not identity.

## Cross-replica command atom

The current process-local queue remains a local ordering optimization, not the production lock.
Every mutation must execute under one PostgreSQL transaction-scoped advisory lock:

```text
BEGIN
→ acquire resource/command lock
→ refresh event high-water mark
→ declaration → guard → schema judgment
→ append accepted/rejected/suspended events
→ update rebuildable projections where required
→ COMMIT
```

Lock keys must be deterministic and avoid one global hot lock where resource-level serialization is
sufficient. Definition activation, Draft decision and other global invariants may use dedicated
coarser keys. Retried commands retain existing idempotency/CAS semantics.

Schema changes use a separate versioned migration command and migration lock. Runtime identities do
not receive DDL authority. Readiness requires the expected schema version and bootstrap/replay
integrity.

## Agent Runtime backends

`apps/agent-runner` is a fourth deployable workspace application. It contains transport/process
composition only; generic lifecycle remains in Worker Host modules and specialization semantics
remain in Coding/Writing/Authoring adapters.

`oneshot` mode:

- one sealed Agent Run per K8s Job/Pod;
- fixed digest, ServiceAccount, resource limits, network policy and workspace;
- result returned through the canonical ingress/finalize contract;
- Job deletion is observed cancellation evidence, not the business decision itself.

`daemon` mode:

- registered trusted host profile and fixed workspace roots;
- authenticated delivery, heartbeat, lease and idempotent result;
- disconnect creates a restart/retry boundary;
- no fallback to a different or broader backend.

Both modes consume one resolved envelope. User tasks cannot carry backend, image, cwd, provider,
model, raw environment, resources or network policy.

## Persistence and recovery

The experiment has no StorageClass and each VM exposes an unused 100 GiB data disk. T22 selects
static local PVs because they introduce no controller dependency and make node affinity explicit.

- PostgreSQL 17 is the only authoritative data service.
- Temporal default/visibility and Keycloak use separate databases/roles in that instance.
- Agent workspace/artifact PVs are non-authoritative governed resources with explicit retention.
- Backups are written to a separate node/path, checksummed and restored into an isolated target.
- Recovery acceptance rebuilds projections and compares Business Snapshot hash, identity setup,
  Workflow history and Agent evidence.

This is recovery-oriented single-instance infrastructure. PDBs and multiple stateless replicas reduce
some interruption but do not create database/storage HA.

## Repository ownership

UI4A repository:

- application changes, migration/runtime configuration;
- Dockerfiles and OCI metadata;
- generic Compose and Helm artifacts;
- generic deployment/acceptance/backup scripts and runbook.

`mothership-setup` repository:

- `deploy/ui4a/` values/overlay;
- node-local paths, static PV mapping, ingress NodePort and internal host facts;
- cluster-specific image preload and operator instructions.

The mothership worktree already contains unrelated modified/untracked files. Implementation must
preserve them, touch only the scoped integration, commit each repository separately, and record both
SHAs.

## Dependency direction

The product dependency direction remains:

```text
shared ← engine ← agent
```

Deployment adapters stay at application/process boundaries. Kubernetes, Keycloak, Temporal,
PostgreSQL and network clients do not enter the pure engine or shared platform-neutral contracts.

## Experimental release boundary

`v0.1.0-experimental.1` is complete only when the same image digests pass Compose and live
mothership acceptance, auth negatives, dual Runtime corpus, two-replica concurrency, backup/restore,
upgrade and rollback.

The release explicitly does not claim:

- public internet exposure or public CA;
- database/Temporal/Keycloak/storage HA;
- multi-region or cross-cluster recovery;
- stable Keycloak JWT `act` emission;
- GA, production SLA, LTS or automatic Agent merge/deploy/activation.
