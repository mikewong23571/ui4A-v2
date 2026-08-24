import { constants } from 'node:fs';
import { chmod, chown, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const maximumSourceBytes = 1024 * 1024;
const sourceOpenFlags = constants.O_RDONLY | constants.O_NOFOLLOW;
const stageOpenFlags =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

const defaultInput = Object.freeze({
  sources: Object.freeze({
    settings: '/run/ui4a/settings.json',
    deploymentSecrets: '/run/secrets/ui4a-deployment-secrets',
    callbackToken: '/run/secrets/capability-callback-token',
    temporalSchemaPassword: '/run/secrets/temporal-schema-password',
    temporalRuntimePassword: '/run/secrets/temporal-runtime-password',
    keycloakDatabasePassword: '/run/secrets/keycloak-database-password',
    keycloakBootstrapAdminPassword: '/run/secrets/keycloak-bootstrap-admin-password',
  }),
  targetDirectory: '/var/run/ui4a/runtime-config',
  runnerTargetDirectory: '/var/run/ui4a/runner-config',
  hostRunnerTargetDirectory: '/var/run/ui4a/host-runner-config',
  uid: 1000,
  gid: 1000,
});

const targets = Object.freeze([
  ['settings', 'settings.json'],
  ['deploymentSecrets', 'deployment-secrets.json'],
  ['callbackToken', 'capability-callback-token'],
  ['temporalSchemaPassword', 'temporal-schema-password'],
  ['temporalRuntimePassword', 'temporal-runtime-password'],
  ['keycloakDatabasePassword', 'keycloak-database-password'],
  ['keycloakBootstrapAdminPassword', 'keycloak-bootstrap-admin-password'],
]);

function fail(code) {
  throw new Error(code);
}

function validateIdentity(uid, gid) {
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1) {
    fail('UI4A_RUNTIME_CONFIG_TARGET_INVALID');
  }
}

async function readPrivateRegularFile(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) {
    fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
  }
  let handle;
  try {
    handle = await open(path, sourceOpenFlags);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size < 1 ||
      before.size > maximumSourceBytes ||
      (before.mode & 0o077) !== 0
    ) {
      fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
    }
    const material = await handle.readFile();
    const after = await handle.stat();
    if (
      material.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ino !== before.ino
    ) {
      fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
    }
    return material;
  } catch (error) {
    if (error instanceof Error && error.message === 'UI4A_RUNTIME_CONFIG_SOURCE_INVALID') {
      throw error;
    }
    fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function validateTargetDirectory(path, uid, gid) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) {
    fail('UI4A_RUNTIME_CONFIG_TARGET_INVALID');
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  const facts = await lstat(path);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    fail('UI4A_RUNTIME_CONFIG_TARGET_INVALID');
  }
  await chown(path, uid, gid);
  await chmod(path, 0o700);
}

async function writePrivateStage(targetDirectory, name, material, uid, gid) {
  const target = join(targetDirectory, name);
  const stage = join(targetDirectory, `.${basename(name)}.${process.pid}.tmp`);
  let handle;
  try {
    handle = await open(stage, stageOpenFlags, 0o600);
    await handle.writeFile(material);
    await handle.sync();
    await handle.chown(uid, gid);
    await handle.chmod(0o400);
    await handle.close();
    handle = undefined;
    await rename(stage, target);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(stage).catch(() => undefined);
    fail('UI4A_RUNTIME_CONFIG_TARGET_INVALID');
  }
}

function runnerSecretProjection(settingsMaterial, secretsMaterial, runnerId) {
  let settings;
  let secrets;
  try {
    settings = JSON.parse(settingsMaterial.toString('utf8'));
    secrets = JSON.parse(secretsMaterial.toString('utf8'));
  } catch {
    fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
  }
  if (
    typeof settings !== 'object' ||
    settings === null ||
    typeof settings.llm !== 'object' ||
    settings.llm === null ||
    typeof settings.llm.apiKeyRef !== 'string' ||
    typeof settings.runtime !== 'object' ||
    settings.runtime === null ||
    !Array.isArray(settings.runtime.profiles) ||
    typeof secrets !== 'object' ||
    secrets === null ||
    Array.isArray(secrets)
  ) {
    fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
  }
  const selected = settings.runtime.profiles.filter(
    (profile) =>
      typeof profile === 'object' &&
      profile !== null &&
      profile.backend === 'host' &&
      profile.runnerId === runnerId,
  );
  if (selected.length === 0) fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
  const refs = new Set([settings.llm.apiKeyRef]);
  for (const profile of selected) {
    if (
      typeof profile.runnerTokenRef !== 'string' ||
      !Array.isArray(profile.credentialRefs) ||
      profile.credentialRefs.some((ref) => typeof ref !== 'string')
    ) {
      fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
    }
    refs.add(profile.runnerTokenRef);
    for (const ref of profile.credentialRefs) refs.add(ref);
  }
  const projection = {};
  for (const ref of refs) {
    if (typeof secrets[ref] !== 'string' || secrets[ref] === '') {
      fail('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
    }
    projection[ref] = secrets[ref];
  }
  return Buffer.from(JSON.stringify(projection), 'utf8');
}

async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Copy root-readable rootless bind inputs into one retained, private, uid-1000 runtime volume.
 * The result contains only a stable outcome and count; paths and material are never returned.
 */
export async function initializeRuntimeConfig(input = defaultInput) {
  validateIdentity(input.uid, input.gid);
  const targetDirectory = input.targetDirectory;
  const material = new Map();
  for (const [sourceName, targetName] of targets) {
    material.set(targetName, await readPrivateRegularFile(input.sources[sourceName]));
  }
  const settings = material.get('settings.json');
  const deploymentSecrets = material.get('deployment-secrets.json');
  const runnerSecrets = runnerSecretProjection(
    settings,
    deploymentSecrets,
    'compose-container-runner',
  );
  const hostRunnerSecrets = runnerSecretProjection(
    settings,
    deploymentSecrets,
    'compose-host-runner',
  );
  await validateTargetDirectory(targetDirectory, input.uid, input.gid);
  await validateTargetDirectory(input.runnerTargetDirectory, input.uid, input.gid);
  await validateTargetDirectory(input.hostRunnerTargetDirectory, input.uid, input.gid);
  for (const [, targetName] of targets) {
    await writePrivateStage(
      targetDirectory,
      targetName,
      material.get(targetName),
      input.uid,
      input.gid,
    );
  }
  for (const [directory, secrets] of [
    [input.runnerTargetDirectory, runnerSecrets],
    [input.hostRunnerTargetDirectory, hostRunnerSecrets],
  ]) {
    await writePrivateStage(directory, 'settings.json', settings, input.uid, input.gid);
    await writePrivateStage(directory, 'runner-secrets.json', secrets, input.uid, input.gid);
  }
  await Promise.all([
    syncDirectory(targetDirectory),
    syncDirectory(input.runnerTargetDirectory),
    syncDirectory(input.hostRunnerTargetDirectory),
  ]);
  return { code: 'UI4A_RUNTIME_CONFIG_READY', files: targets.length + 4 };
}

export async function runConfigInit({
  initialize = initializeRuntimeConfig,
  write = console.log,
} = {}) {
  try {
    write(JSON.stringify(await initialize()));
    return 0;
  } catch {
    write(JSON.stringify({ code: 'UI4A_RUNTIME_CONFIG_INIT_FAILED' }));
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) process.exitCode = await runConfigInit();
