import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { generateStagedInventory, publishStagedInventory } from './pki-generate.js';
import {
  ensureWritableRoot,
  expectedMode,
  fail,
  inventoryState,
  LOCK_DIRECTORY,
  MATERIAL_IDS,
  requireHost,
  runOpenSsl,
  RUNNER_PKI_FILES,
  safeRootDirectory,
  type RunnerPkiInput,
  type RunnerPkiResult,
} from './pki-inventory.js';
import { validateInventory } from './pki-validate.js';

export {
  RUNNER_PKI_FILES,
  type PkiProcessResult,
  type PkiProcessRunner,
  type RunnerPkiFileId,
  type RunnerPkiInput,
  type RunnerPkiResult,
} from './pki-inventory.js';

async function result(
  status: RunnerPkiResult['status'],
  rootDirectory: string,
): Promise<RunnerPkiResult> {
  return {
    status,
    rootDirectory,
    files: await Promise.all(
      MATERIAL_IDS.map(async (id) => {
        const path = join(rootDirectory, RUNNER_PKI_FILES[id]);
        return {
          id,
          path,
          sha256: `sha256:${createHash('sha256')
            .update(await readFile(path))
            .digest('hex')}`,
          mode: expectedMode(id),
        };
      }),
    ),
    postgresHandoff: {
      certificatePath: join(rootDirectory, RUNNER_PKI_FILES.postgresCertificate),
      privateKeyPath: join(rootDirectory, RUNNER_PKI_FILES.postgresPrivateKey),
      certificateMode: 0o644,
      privateKeyMode: 0o600,
      ownership: 'deployment-adapter-copy-init',
    },
  };
}

function postgresDnsNames(postgresHost: string): string[] {
  const host = requireHost(postgresHost);
  const match = /^([a-z0-9-]+)\.([a-z0-9-]+)\.svc\.cluster\.local$/.exec(host);
  if (match === null) return [host];
  return [match[1]!, `${match[1]}.${match[2]}.svc`, host];
}

/** Generate or validate the fixed experimental CA inventory without ever rotating existing files. */
export async function initializeRunnerPki(input: RunnerPkiInput): Promise<RunnerPkiResult> {
  const rootDirectory = safeRootDirectory(input.rootDirectory);
  const ui4aHost = requireHost(input.ui4aHost);
  const keycloakHost = requireHost(input.keycloakHost);
  const postgresHost = requireHost(input.postgresHost);
  const postgresNames = postgresDnsNames(postgresHost);
  const edgeUid = input.edgeUid ?? 1000;
  const edgeGid = input.edgeGid ?? 1000;
  if (
    !Number.isSafeInteger(edgeUid) ||
    edgeUid < 0 ||
    !Number.isSafeInteger(edgeGid) ||
    edgeGid < 0
  ) {
    fail('PKI_CONFIGURATION_INVALID');
  }
  if (ui4aHost === keycloakHost || ui4aHost === postgresHost || keycloakHost === postgresHost) {
    fail('PKI_CONFIGURATION_INVALID');
  }
  await ensureWritableRoot(rootDirectory);

  const initialState = await inventoryState(rootDirectory);
  if (initialState === 'partial') fail('PKI_PARTIAL_STATE');
  if (initialState === 'complete') {
    await validateInventory({
      rootDirectory,
      ui4aHost,
      keycloakHost,
      postgresHost,
      postgresDnsNames: postgresNames,
      edgeUid,
      edgeGid,
    });
    return result('reused', rootDirectory);
  }

  const lockDirectory = join(rootDirectory, LOCK_DIRECTORY);
  try {
    await mkdir(lockDirectory);
  } catch {
    fail('PKI_INIT_BUSY');
  }

  let stageDirectory: string | undefined;
  try {
    const lockedState = await inventoryState(rootDirectory);
    if (lockedState === 'partial') fail('PKI_PARTIAL_STATE');
    if (lockedState === 'complete') {
      await validateInventory({
        rootDirectory,
        ui4aHost,
        keycloakHost,
        postgresHost,
        postgresDnsNames: postgresNames,
        edgeUid,
        edgeGid,
      });
      return result('reused', rootDirectory);
    }
    stageDirectory = await mkdtemp(join(rootDirectory, '.pki-stage-'));
    await generateStagedInventory({
      runner: input.processRunner ?? runOpenSsl,
      stageDirectory,
      ui4aHost,
      keycloakHost,
      postgresHost,
      postgresDnsNames: postgresNames,
    });
    await publishStagedInventory({
      rootDirectory,
      stageDirectory,
      ui4aHost,
      keycloakHost,
      postgresHost,
      postgresDnsNames: postgresNames,
      edgeUid,
      edgeGid,
    });
    await validateInventory({
      rootDirectory,
      ui4aHost,
      keycloakHost,
      postgresHost,
      postgresDnsNames: postgresNames,
      edgeUid,
      edgeGid,
    });
    return result('created', rootDirectory);
  } finally {
    if (stageDirectory !== undefined) await rm(stageDirectory, { force: true, recursive: true });
    await rm(lockDirectory, { force: true, recursive: true });
  }
}
