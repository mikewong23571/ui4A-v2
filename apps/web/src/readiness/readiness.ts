import {
  aggregateReadiness,
  type ReadinessDependencyInput,
  type ReadinessResult,
} from '@ui4a/shared';

import {
  getApplicationBootstrapStatus,
  getMigrationStatus,
  type ApplicationBootstrapStatus,
  type MigrationStatus,
} from '../db/migrations';
import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';
import { getDb } from '../engine/service';

type RequiredDependency = 'config' | 'postgres' | 'migration' | 'bootstrap' | 'replay';
type OptionalDependency = 'temporal' | 'keycloak' | 'llm' | 'runtime';

export interface WebReadinessDependencies<Db> {
  preflight(): unknown;
  database(): Db;
  postgres(db: Db): Promise<void>;
  migration(db: Db): Promise<MigrationStatus>;
  bootstrap(db: Db): Promise<ApplicationBootstrapStatus>;
  temporal?: () => Promise<void>;
  keycloak?: () => Promise<void>;
  llm?: () => Promise<void>;
  runtime?: () => Promise<void>;
}

function state(
  required: boolean,
  status: ReadinessDependencyInput['status'],
  reasonCode?: string,
): ReadinessDependencyInput {
  return {
    required,
    status,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

function initialDependencies(): Record<
  RequiredDependency | OptionalDependency,
  ReadinessDependencyInput
> {
  return {
    config: state(true, 'unknown', 'deployment_config_not_checked'),
    postgres: state(true, 'unknown', 'postgres_not_checked'),
    migration: state(true, 'unknown', 'migration_not_checked'),
    bootstrap: state(true, 'unknown', 'bootstrap_not_checked'),
    replay: state(true, 'unknown', 'replay_not_checked'),
    temporal: state(false, 'unknown', 'temporal_not_checked'),
    keycloak: state(false, 'unknown', 'keycloak_not_checked'),
    llm: state(false, 'unknown', 'llm_not_checked'),
    runtime: state(false, 'unknown', 'runtime_backend_not_checked'),
  };
}

function replayReceiptReady(status: ApplicationBootstrapStatus): boolean {
  const receipt = status.receipt;
  return (
    receipt !== undefined &&
    receipt.schemaVersion === 1 &&
    receipt.migrationVersion === status.migrationVersion &&
    Number.isSafeInteger(receipt.eventHighWaterMark) &&
    receipt.eventHighWaterMark >= 0 &&
    /^sha256:[0-9a-f]{64}$/.test(receipt.replayHash)
  );
}

async function probeOptional(
  dependencies: Record<RequiredDependency | OptionalDependency, ReadinessDependencyInput>,
  name: OptionalDependency,
  probe: (() => Promise<void>) | undefined,
  unavailableCode: string,
): Promise<void> {
  if (probe === undefined) return;
  try {
    await probe();
    dependencies[name] = state(false, 'ok');
  } catch {
    dependencies[name] = state(false, 'error', unavailableCode);
  }
}

/** Run bounded, read-only Web checks and normalize every failure to a stable public code. */
export async function probeWebReadiness<Db>(
  probes: WebReadinessDependencies<Db>,
): Promise<ReadinessResult> {
  const dependencies = initialDependencies();
  try {
    probes.preflight();
    dependencies.config = state(true, 'ok');
  } catch {
    dependencies.config = state(true, 'error', 'deployment_config_invalid');
    return aggregateReadiness({ component: 'ui4a-web', lifecycle: 'serving', dependencies });
  }

  let database: Db;
  try {
    database = probes.database();
    await probes.postgres(database);
    dependencies.postgres = state(true, 'ok');
  } catch {
    dependencies.postgres = state(true, 'error', 'postgres_unavailable');
    return aggregateReadiness({ component: 'ui4a-web', lifecycle: 'serving', dependencies });
  }

  let migration: MigrationStatus;
  try {
    migration = await probes.migration(database);
  } catch {
    dependencies.migration = state(true, 'error', 'migration_status_unavailable');
    return aggregateReadiness({ component: 'ui4a-web', lifecycle: 'serving', dependencies });
  }
  if (!migration.ready) {
    dependencies.migration = state(
      true,
      'error',
      migration.state === 'incompatible' ? 'migration_incompatible' : 'migration_required',
    );
    return aggregateReadiness({ component: 'ui4a-web', lifecycle: 'serving', dependencies });
  }
  dependencies.migration = state(true, 'ok');

  let bootstrap: ApplicationBootstrapStatus;
  try {
    bootstrap = await probes.bootstrap(database);
  } catch {
    dependencies.bootstrap = state(true, 'error', 'bootstrap_status_unavailable');
    return aggregateReadiness({ component: 'ui4a-web', lifecycle: 'serving', dependencies });
  }
  if (!bootstrap.ready) {
    dependencies.bootstrap = state(true, 'error', 'bootstrap_incomplete');
  } else {
    dependencies.bootstrap = state(true, 'ok');
    dependencies.replay = replayReceiptReady(bootstrap)
      ? state(true, 'ok')
      : state(true, 'error', 'replay_integrity_unverified');
  }

  await Promise.all([
    probeOptional(dependencies, 'temporal', probes.temporal, 'temporal_unavailable'),
    probeOptional(dependencies, 'keycloak', probes.keycloak, 'keycloak_unavailable'),
    probeOptional(dependencies, 'llm', probes.llm, 'llm_unavailable'),
    probeOptional(dependencies, 'runtime', probes.runtime, 'runtime_backend_unavailable'),
  ]);

  return aggregateReadiness({ component: 'ui4a-web', lifecycle: 'serving', dependencies });
}

/** Production composition: required checks are read-only; optional network checks remain explicit. */
export function getWebReadinessSnapshot(): Promise<ReadinessResult> {
  return probeWebReadiness({
    preflight: () => runWebProductionDeploymentPreflight(),
    database: () => getDb(),
    postgres: async (db) => {
      const result = await db.query<{ ok: number }>('SELECT 1 AS ok');
      if (result.rows[0]?.ok !== 1) throw new Error('postgres readiness check failed');
    },
    migration: (db) => getMigrationStatus(db),
    bootstrap: (db) => getApplicationBootstrapStatus(db),
  });
}
