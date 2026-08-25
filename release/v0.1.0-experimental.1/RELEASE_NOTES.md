# UI4A v0.1.0-experimental.1

This bundle is an **internal experiment** for the trusted mothership network. It is non-HA, not
GA, offers no SLA, is not LTS, and must not be used for production. It records what was actually
tested; a generated artifact or a running Pod is not evidence for an unexecuted user story.

## Included scope

- Digest-pinned Web, Worker and Runner images built from
  `44a1fe37d9806434cc5d97a4ec0bc45197cce3ce` for linux/amd64 with numeric non-root runtime users.
- Compose all-in-one and mothership Kubernetes configuration contracts for PostgreSQL 17,
  Temporal, Keycloak, Web, Worker, Istio and the two server-owned Runner backends.
- Authorization Code + PKCE, CLI token authentication, bounded Agent delegation using `sub +
azp`, and application-enforced human-only approval.
- A verified single-Web concurrency/restart/replay drill and a named, quiesced ten-artifact backup
  restored into isolated retained PV roots with RPO 0 and measured RTO.
- A 19-section step-by-step runbook with explicit expected output, failure criteria and recovery
  actions.

## Vulnerability known risk

The images were scanned without project-specific suppression using Syft 1.51.0 and Grype 0.117.0
against database v6.1.9 built on 2026-08-24. The scan found **50 Critical matches** and **241 High
matches** across the three images:

| Image  | Critical | High | Total matches |
| ------ | -------: | ---: | ------------: |
| Web    |       10 |   69 |           266 |
| Worker |       10 |   69 |           266 |
| Runner |       30 |  103 |           414 |

These findings are accepted only as a visible known risk for this isolated internal experiment.
They are not remediated by this bundle and are not marked passed. Details and fix-state counts are
in `vulnerability-summary.json`; the complete package inventories are the SPDX-2.3 SBOMs.

## Compatibility

- Supported topology: one Web, one Worker, one PostgreSQL, one Temporal server, one Keycloak and
  one realm. Multiple cluster nodes do not imply application HA.
- Images and configuration use the same experimental release contract. Only immutable digests and
  an exact OCI source revision are accepted.
- PostgreSQL is authoritative business state. Temporal history is durable execution state, not a
  replacement business store.
- Existing realms are checked for compatibility and skipped. Realm online reconciliation and
  general drift repair are outside this compatibility window.
- Rollback is only a documented revision-19 plan. It was not executed for these final images.

## Known limitations

- The final `44a1fe3` images package the required Codex CLI, sealed `CODEX_HOME` preparation and the
  trusted-host workspace correction. Cross-node immutable inventory and final Runtime evidence must
  be read from this bundle; rollback and roll-forward were not executed, so U15 remains a plan.
- Bounded fault injection against LLM, PostgreSQL, Temporal, Keycloak/JWKS and both Runtime
  backends was not executed for this bundle.
- Kubernetes NetworkPolicy isolation was not implemented or live-verified; Istio and application
  authorization do not substitute for NetworkPolicy.
- Fresh-install dependency wait loops and their least-privilege read RBAC remain a known gate; the
  final-image rollout was not used to claim that path passed.
- The automatic Helm backup CronJob is suspended and non-authoritative because it contains only an
  incomplete single-database fixture. The verified host-operated ten-artifact backup/isolated
  restore is the only recovery evidence.
- The final Runtime matrix is `failed-honest`, not passed. Compose U7 failed with `execute-failed` /
  Activity task failure before events or artifacts. The single final K8s Run
  `a1o-20407625d83e` also terminated `execute-failed`; its exact Runner digest, disabled sidecar and
  scoped credential projection were attested, but it produced no accepted result. Neither path
  fell back, U8 was not attempted, and no acceptance action ran. Requests still cannot select
  backend, image, working directory, provider, model, environment or credentials.
- Multi-replica Web/session behavior, automated credential rotation, nested `act`, broad
  service-to-service OIDC and realm online upgrade are deferred.
- The bundle does not create a Git tag and does not promise future upgrade compatibility.

## Operator boundary

Follow `docs/t22-production-runbook.md`. Do not use prune, broad label deletion, Helm `--force`, an
in-place restore, or an online realm repair. Retained data and the experimental CA require an
explicit, separately reviewed deletion decision.
