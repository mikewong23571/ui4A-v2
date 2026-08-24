import {
  aggregateReadiness,
  type ReadinessDependencyInput,
  type ReadinessDependencyStatus,
  type ReadinessLifecycle,
  type ReadinessResult,
} from '@ui4a/shared';

import type { DbExecutor } from '../../web/src/db/events';
import { getApplicationBootstrapStatus, getMigrationStatus } from '../../web/src/db/migrations';

export type WorkerDependencyName =
  'config' | 'postgres' | 'migration' | 'bootstrap' | 'replay' | 'temporal';

export interface WorkerReadinessState {
  markDependency(
    name: WorkerDependencyName,
    status: ReadinessDependencyStatus,
    reasonCode?: string,
  ): void;
  markServing(): void;
  beginDraining(): void;
  snapshot(): ReadinessResult;
}

const DEPENDENCY_NAMES = [
  'config',
  'postgres',
  'migration',
  'bootstrap',
  'replay',
  'temporal',
] as const;

/** Create the monotonic, process-local lifecycle used by Worker health and shutdown composition. */
export function createWorkerReadinessState(): WorkerReadinessState {
  let lifecycle: ReadinessLifecycle = 'starting';
  const dependencies: Record<WorkerDependencyName, ReadinessDependencyInput> = {
    config: { required: true, status: 'unknown', reasonCode: 'config_not_checked' },
    postgres: { required: true, status: 'unknown', reasonCode: 'postgres_not_checked' },
    migration: { required: true, status: 'unknown', reasonCode: 'migration_not_checked' },
    bootstrap: { required: true, status: 'unknown', reasonCode: 'bootstrap_not_checked' },
    replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
    temporal: { required: true, status: 'unknown', reasonCode: 'temporal_not_checked' },
  };

  function snapshot(): ReadinessResult {
    return aggregateReadiness({ component: 'ui4a-worker', lifecycle, dependencies });
  }

  return {
    markDependency(name, status, reasonCode) {
      dependencies[name] = {
        required: true,
        status,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },
    markServing() {
      if (lifecycle !== 'starting') {
        throw new Error(`invalid Worker readiness transition ${lifecycle} -> serving`);
      }
      if (DEPENDENCY_NAMES.some((name) => dependencies[name].status !== 'ok')) {
        throw new Error('Worker cannot serve before required dependencies are ready');
      }
      lifecycle = 'serving';
    },
    beginDraining() {
      if (lifecycle === 'draining') return;
      if (lifecycle !== 'serving') {
        throw new Error(`invalid Worker readiness transition ${lifecycle} -> draining`);
      }
      lifecycle = 'draining';
    },
    snapshot,
  };
}

export interface WorkerDependencyProbeInput {
  db: DbExecutor;
  getMigrationStatus?: typeof getMigrationStatus;
  getBootstrapStatus?: typeof getApplicationBootstrapStatus;
}

export type WorkerPersistentDependencySnapshot = Record<
  'postgres' | 'migration' | 'bootstrap' | 'replay',
  ReadinessDependencyInput & { required: true }
>;

function uncheckedPersistentDependencies(
  postgres: WorkerPersistentDependencySnapshot['postgres'],
): WorkerPersistentDependencySnapshot {
  return {
    postgres,
    migration: { required: true, status: 'unknown', reasonCode: 'migration_not_checked' },
    bootstrap: { required: true, status: 'unknown', reasonCode: 'bootstrap_not_checked' },
    replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
  };
}

/** Read-only PostgreSQL, migration, and bootstrap receipt probe with bounded public diagnostics. */
export async function probeWorkerDependencies(
  input: WorkerDependencyProbeInput,
): Promise<WorkerPersistentDependencySnapshot> {
  try {
    await input.db.query('SELECT 1');
  } catch {
    return uncheckedPersistentDependencies({
      required: true,
      status: 'error',
      reasonCode: 'postgres_unavailable',
    });
  }

  const readMigration = input.getMigrationStatus ?? getMigrationStatus;
  const readBootstrap = input.getBootstrapStatus ?? getApplicationBootstrapStatus;
  try {
    const migration = await readMigration(input.db);
    if (!migration.ready) {
      return {
        postgres: { required: true, status: 'ok' },
        migration: { required: true, status: 'degraded', reasonCode: 'migration_required' },
        bootstrap: { required: true, status: 'unknown', reasonCode: 'bootstrap_not_checked' },
        replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
      };
    }
    const bootstrap = await readBootstrap(input.db);
    if (!bootstrap.ready) {
      return {
        postgres: { required: true, status: 'ok' },
        migration: { required: true, status: 'ok' },
        bootstrap: { required: true, status: 'degraded', reasonCode: 'bootstrap_required' },
        replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
      };
    }
    const receipt = bootstrap.receipt;
    const replayReady =
      receipt?.schemaVersion === 1 &&
      receipt.migrationVersion === migration.currentVersion &&
      Number.isSafeInteger(receipt.eventHighWaterMark) &&
      receipt.eventHighWaterMark >= 0 &&
      /^sha256:[0-9a-f]{64}$/.test(receipt.replayHash);
    return {
      postgres: { required: true, status: 'ok' },
      migration: { required: true, status: 'ok' },
      bootstrap: { required: true, status: 'ok' },
      replay: replayReady
        ? { required: true, status: 'ok' }
        : { required: true, status: 'error', reasonCode: 'replay_receipt_invalid' },
    };
  } catch {
    return {
      postgres: { required: true, status: 'ok' },
      migration: { required: true, status: 'error', reasonCode: 'migration_probe_failed' },
      bootstrap: { required: true, status: 'unknown', reasonCode: 'bootstrap_not_checked' },
      replay: { required: true, status: 'unknown', reasonCode: 'replay_not_checked' },
    };
  }
}
