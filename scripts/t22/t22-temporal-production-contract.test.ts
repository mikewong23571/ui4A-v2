import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = 'deploy/temporal/production-contract.json';
const workerConnectionPath = 'apps/worker/src/temporal-connection.ts';

function requiredSource(path: string): string {
  const absolute = resolve(repositoryRoot, path);
  if (!existsSync(absolute)) throw new Error(`missing T22 Temporal production artifact: ${path}`);
  return readFileSync(absolute, 'utf8');
}

function requiredJson<T>(path: string): T {
  return JSON.parse(requiredSource(path)) as T;
}

interface TemporalProductionContract {
  schemaVersion: 1;
  versions: {
    server: string;
    ui: string;
    cli: string;
    helmChart: string;
    postgresql: string;
  };
  topology: {
    highAvailability: false;
    replicas: Record<'frontend' | 'history' | 'matching' | 'worker' | 'ui', number>;
  };
  persistence: {
    driver: 'postgresql';
    bundledDatabase: false;
    defaultStore: {
      database: 'temporal';
      schemaUserRef: string;
      runtimeUserRef: string;
      schemaPasswordRef: string;
      runtimePasswordRef: string;
    };
    visibilityStore: {
      database: 'temporal_visibility';
      schemaUserRef: string;
      runtimeUserRef: string;
      schemaPasswordRef: string;
      runtimePasswordRef: string;
    };
  };
  jobs: {
    schemaSetup: { enabled: true; order: number };
    schemaUpdate: { enabled: true; order: number };
    namespace: { enabled: true; order: number; name: 'ui4a'; mode: 'create-or-check' };
  };
}

describe('T22 Temporal production persistence contract (Red)', () => {
  it('pins one non-HA Temporal server topology with external PostgreSQL', () => {
    const contract = requiredJson<TemporalProductionContract>(contractPath);

    expect(contract).toMatchObject({
      schemaVersion: 1,
      versions: {
        server: '1.31.2',
        ui: '2.50.1',
        cli: '1.8.2',
        helmChart: '1.6.0',
        postgresql: '17',
      },
      topology: {
        highAvailability: false,
        replicas: { frontend: 1, history: 1, matching: 1, worker: 1, ui: 1 },
      },
      persistence: { driver: 'postgresql', bundledDatabase: false },
    });
  });

  it('isolates default and visibility stores and orders schema plus namespace jobs', () => {
    const contract = requiredJson<TemporalProductionContract>(contractPath);
    const { defaultStore, visibilityStore } = contract.persistence;

    expect(defaultStore.database).toBe('temporal');
    expect(visibilityStore.database).toBe('temporal_visibility');
    expect(defaultStore.database).not.toBe(visibilityStore.database);
    expect(defaultStore.schemaUserRef).not.toBe(defaultStore.runtimeUserRef);
    expect(visibilityStore.schemaUserRef).not.toBe(visibilityStore.runtimeUserRef);
    expect(defaultStore.schemaPasswordRef).not.toBe(defaultStore.runtimePasswordRef);
    expect(visibilityStore.schemaPasswordRef).not.toBe(visibilityStore.runtimePasswordRef);
    expect(contract.jobs).toEqual({
      schemaSetup: { enabled: true, order: 1 },
      schemaUpdate: { enabled: true, order: 2 },
      namespace: { enabled: true, order: 3, name: 'ui4a', mode: 'create-or-check' },
    });
    expect(requiredSource(contractPath)).not.toMatch(/password\s*":\s*"(?![^"-]*Ref)/i);
  });

  it('requires a bounded Worker NativeConnection adapter instead of an unbounded address-only call', () => {
    const source = requiredSource(workerConnectionPath);

    expect(source).toContain('NativeConnection.connect');
    expect(source).toContain('connectTimeoutMs');
    expect(source).toMatch(/Promise\.race|AbortSignal\.timeout/);
    expect(source).toMatch(/late|close/i);
    expect(source).toMatch(/transport|tls/);
  });
});
