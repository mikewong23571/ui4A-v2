# T22 PostgreSQL and Temporal Topology Probe

## Outcome

The current PostgreSQL and Temporal libraries support the production-shaped boundaries required by
T22:

- PostgreSQL transaction advisory locks serialize two independent clients.
- A versioned migration can be idempotent and a failed migration rolls back atomically.
- Temporal namespace is configurable at the service/client boundary.
- Completed Workflow result and 10-event history survive a full server restart.
- The current UI4A Worker honors a custom task queue and drains on SIGTERM.

The target experimental topology will use one PostgreSQL 17 instance on a static local PV, with
separate databases/roles for UI4A, Keycloak, Temporal default, and Temporal visibility. This is a
single-instance recovery-oriented topology, not HA.

## PostgreSQL probe

The live probe used a separate `ui4a_t22_probe` database inside the existing mothership PostgreSQL
16 container. It did not read or modify the Mattermost database. The probe database was dropped and
confirmed absent.

Two independent psql processes executed the same transaction-scoped advisory lock:

```sql
SELECT pg_advisory_xact_lock(740922);
```

The second process waited 1.772 seconds while the first held the lock.

Migration assertions:

- concurrent version 1 inserts used a primary key plus `ON CONFLICT DO NOTHING`;
- exactly one version 1 row existed;
- a transaction inserting version 2 and then dividing by zero failed;
- version 2 count remained zero;
- the probe database was removed.

PostgreSQL 16 was only a safe available execution host for standard transaction/lock semantics. The
deployment remains pinned to PostgreSQL 17.

## Temporal probe

Pinned disposable components:

| Component | Version |
|---|---|
| Temporal CLI | 1.8.2 |
| Temporal Server | 1.31.2 |
| Temporal UI | 2.50.1 |
| UI4A TypeScript SDK | 1.22.0 |

The probe started the Temporal dev server on a temporary SQLite file, registered namespace
`ui4a-probe`, ran `durableProbeWorkflow`, and observed 10 history events. It then stopped the
server completely, restarted from the same persistence file, and read the same namespace, completed
result, and 10-event history.

This proves client/server compatibility and durability mechanics; SQLite dev persistence is not the
production store.

## Worker drain

The real `apps/worker/src/main.ts` ran against task queue `t22-drain-probe`. SIGTERM produced:

```text
RUNNING → STOPPING → DRAINING → DRAINED → STOPPED
```

No activity was dispatched and no business/database state was touched.

The probe also confirms the remaining product gap: Worker namespace is currently hardcoded to
`default`. T22 must add a deployment-owned `TEMPORAL_NAMESPACE` used consistently by Web, Worker,
tests, and Runner coordination.

## Selected experimental topology

Because the live cluster has no StorageClass and only two schedulable workers:

- use a static local PV on one explicitly selected worker for PostgreSQL 17;
- use one PostgreSQL instance with distinct databases and least-privilege roles;
- keep UI4A, Keycloak, `temporal`, and `temporal_visibility` logically isolated;
- deploy Temporal services from the official chart against that database;
- keep `numHistoryShards` fixed from first install;
- use Temporal namespace `ui4a`;
- store backups on a separate node/path and prove restore;
- do not claim database, Temporal, or Keycloak HA.

`local-path-provisioner` remains a future convenience option, not an experimental release
dependency.

## Chart boundary

The current official Temporal Helm chart deploys Temporal server components only and expects
external persistence. That aligns with T22: UI4A owns the PostgreSQL StatefulSet/static PV and
supplies Temporal credentials through an existing Secret. Temporal schema setup/update must be an
explicit Job before server readiness.

## Sources

- [Temporal Helm charts](https://github.com/temporalio/helm-charts)
- [Temporal chart values](https://github.com/temporalio/helm-charts/blob/main/charts/temporal/values.yaml)
- [Temporal schema Job template](https://github.com/temporalio/helm-charts/blob/main/charts/temporal/templates/server-job.yaml)
- [Temporal CLI](https://github.com/temporalio/cli)

Executable Workflow probes:

- [scripts/t22-temporal-probe.ts](../../../scripts/t22-temporal-probe.ts)
- [apps/worker/src/t22-temporal-probe-workflows.ts](../../../apps/worker/src/t22-temporal-probe-workflows.ts)

Machine-readable results are in [topology-probe.json](./topology-probe.json).
