import { createHash } from 'node:crypto';

import { assertMetaBootstrapIntegrity, canonicalJson, fold, planMetaBootstrap } from '@ui4a/engine';

import { installedAgentDefinitions } from '../applications/agent-definitions';
import { installedApplicationBundles } from '../applications/bundles';
import {
  installSeedAgentDefinition,
  rebuildAgentDefinitionProjection,
} from '@ui4a/db/agent-definitions';
import { appendEvent, readLog, type DbExecutor } from '@ui4a/db/events';
import {
  assertMigrationsReady,
  recordApplicationBootstrapReceipt,
  type ApplicationBootstrapStatus,
} from '@ui4a/db/migrations';

async function bootstrapApplicationBundles(db: DbExecutor): Promise<void> {
  for (const bundle of installedApplicationBundles) {
    const log = await readLog(db);
    for (const event of planMetaBootstrap(bundle, log)) await appendEvent(db, event);
  }
}

async function bootstrapAgentDefinitions(db: DbExecutor): Promise<void> {
  for (const definition of installedAgentDefinitions) {
    for (const policyScope of definition.policyScopes) {
      await installSeedAgentDefinition(db, {
        principal: 'local-user',
        policyScope,
        source: definition.source,
        artifact: definition.artifact,
        evalEvidence: definition.evaluation,
      });
    }
  }
}

/** Explicit seed/replay writer; readiness consumes its stored receipt and never invokes this. */
export async function bootstrapAndVerifyApplication(
  db: DbExecutor,
): Promise<ApplicationBootstrapStatus> {
  const migration = await assertMigrationsReady(db);
  await rebuildAgentDefinitionProjection(db);
  await bootstrapApplicationBundles(db);
  await bootstrapAgentDefinitions(db);
  const events = await readLog(db);
  assertMetaBootstrapIntegrity(events);
  const snapshot = fold(events, { flows: {} });
  const replayHash = `sha256:${createHash('sha256').update(canonicalJson(snapshot)).digest('hex')}`;
  return recordApplicationBootstrapReceipt(db, {
    schemaVersion: 1,
    migrationVersion: migration.targetVersion,
    eventHighWaterMark: events.at(-1)?.seq ?? 0,
    replayHash,
  });
}
