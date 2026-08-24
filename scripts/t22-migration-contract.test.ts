import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 migration artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

describe('T22 explicit migration artifact boundary', () => {
  it('registers all six existing DDL artifacts behind one versioned migration module', () => {
    const source = requiredSource('apps/web/src/db/migrations.ts');

    for (const ddl of [
      'EVENTS_DDL',
      'PRESENTATION_DDL',
      'DRAFT_DDL',
      'CAPABILITY_RUN_DDL',
      'AGENT_DEFINITION_DDL',
      'AGENT_RUN_DDL',
    ]) {
      expect(source).toContain(ddl);
    }
    expect(source).toContain('MIGRATION_REGISTRY');
    expect(source).toContain('runMigrations');
    expect(source).toContain('getMigrationStatus');
    expect(source).toMatch(/pg_advisory_xact_lock/);
    expect(source).toContain('ui4a_schema_migrations');
  });

  it('provides a migration-only executable wired to the configured migration role', () => {
    const source = requiredSource('scripts/t22-migrate.ts');

    expect(source).toContain('preflightProductionDeploymentFromEnvironment');
    expect(source).toContain('settings.postgres.migrationUser');
    expect(source).toContain('settings.postgres.migrationPasswordRef');
    expect(source).toContain('runMigrations');
    expect(source).not.toContain('settings.postgres.runtimeUser');
    expect(source).not.toContain('settings.postgres.runtimePasswordRef');
    expect(source).not.toMatch(/ensure[A-Za-z]+Tables?/);
  });

  it('keeps idempotent ensure helpers out of production request and Worker runtime paths', () => {
    const runtimePaths = [
      'apps/web/src/db/drafts.ts',
      'apps/web/src/db/capability-runs.ts',
      'apps/web/src/db/agent-definitions.ts',
      'apps/web/src/db/agent-runs.ts',
      'apps/web/src/db/presentation.ts',
      'apps/web/src/engine/service.ts',
      'apps/web/src/engine/drafts.ts',
      'apps/web/src/engine/agent-definitions.ts',
      'apps/web/src/engine/presentation/runtime.ts',
      'apps/web/src/app/api/presentation/sidecar/route.ts',
      'apps/worker/src/activities.ts',
      'apps/worker/src/delegation.ts',
    ];
    const debts = runtimePaths.flatMap((path) =>
      requiredSource(path)
        .split('\n')
        .flatMap((line, index) => {
          const call = line.trim();
          const legacyHelperComposition =
            path.startsWith('apps/web/src/db/') && call === 'await ensureEventsTable(db);';
          return /await ensure[A-Za-z]+Tables?\(/.test(line) && !legacyHelperComposition
            ? [`${path}:${index + 1}:${call}`]
            : [];
        }),
    );

    expect(debts).toEqual([]);
  });
});
