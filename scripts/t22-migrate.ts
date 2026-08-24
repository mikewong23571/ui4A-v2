import { readFileSync } from 'node:fs';

import { runMigrations, MigrationError } from '../apps/web/src/db/migrations';
import { createMigrationPool } from '../apps/web/src/db/pool';
import { bootstrapAndVerifyApplication } from '../apps/web/src/engine/bootstrap';
import { preflightProductionDeploymentFromEnvironment } from '../packages/shared/src/production-deployment-config';

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('MIGRATION_USAGE_INVALID');
  const config = preflightProductionDeploymentFromEnvironment(process.env, (path) =>
    readFileSync(path, 'utf8'),
  );
  if (config === undefined) throw new Error('MIGRATION_PRODUCTION_PROFILE_REQUIRED');

  const { settings } = config;
  const password = config.secrets[settings.postgres.migrationPasswordRef];
  if (password === undefined) throw new Error('MIGRATION_CREDENTIAL_UNAVAILABLE');
  const pool = createMigrationPool({
    host: settings.postgres.host,
    port: settings.postgres.port,
    database: settings.postgres.database,
    user: settings.postgres.migrationUser,
    password,
    connectTimeoutMs: settings.postgres.connectTimeoutMs,
    ca: readFileSync(settings.postgres.tls.caCertificatePath, 'utf8'),
  });
  try {
    const migration = await runMigrations(pool);
    const bootstrap = await bootstrapAndVerifyApplication(pool);
    process.stdout.write(`${JSON.stringify({ ok: true, migration, bootstrap })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof MigrationError
      ? error.code
      : error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'MIGRATION_FAILED';
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
