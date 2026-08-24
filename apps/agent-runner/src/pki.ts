import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  chown,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const RUNNER_PKI_FILES = {
  rootCertificate: 'root-ca.crt',
  rootPrivateKey: 'root-ca.key',
  ui4aCertificate: 'ui4a/tls.crt',
  ui4aPrivateKey: 'ui4a/tls.key',
  keycloakCertificate: 'keycloak/tls.crt',
  keycloakPrivateKey: 'keycloak/tls.key',
  postgresCertificate: 'postgres/server.crt',
  postgresPrivateKey: 'postgres/server.key',
} as const;

export type RunnerPkiFileId = keyof typeof RUNNER_PKI_FILES;

export interface PkiProcessResult {
  stdout: string;
}

export type PkiProcessRunner = (
  executable: 'openssl',
  args: readonly string[],
) => Promise<PkiProcessResult>;

export interface RunnerPkiResult {
  status: 'created' | 'reused';
  rootDirectory: string;
  files: Array<{
    id: RunnerPkiFileId;
    path: string;
    sha256: string;
    mode: 0o600 | 0o644;
  }>;
  postgresHandoff: {
    certificatePath: string;
    privateKeyPath: string;
    certificateMode: 0o644;
    privateKeyMode: 0o600;
    ownership: 'deployment-adapter-copy-init';
  };
}

export interface RunnerPkiInput {
  rootDirectory: string;
  ui4aHost: string;
  keycloakHost: string;
  postgresHost: string;
  processRunner?: PkiProcessRunner;
  edgeUid?: number;
  edgeGid?: number;
}

const ROOT_COMMON_NAME = 'UI4A Experimental Internal CA';
const COMPLETE_MARKER = '.ui4a-pki-complete.json';
const LOCK_DIRECTORY = '.ui4a-pki-init.lock';
const MATERIAL_IDS = Object.keys(RUNNER_PKI_FILES) as RunnerPkiFileId[];
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function fail(code: string): never {
  throw new Error(code);
}

function expectedMode(id: RunnerPkiFileId): 0o600 | 0o644 {
  return id.endsWith('PrivateKey') ? 0o600 : 0o644;
}

function safeRootDirectory(path: string): string {
  if (!isAbsolute(path)) fail('PKI_CONFIGURATION_INVALID');
  const normalized = resolve(path);
  if (normalized === '/') fail('PKI_CONFIGURATION_INVALID');
  return normalized;
}

function requireHost(host: string): string {
  if (
    !HOST_PATTERN.test(host) ||
    host.includes('..') ||
    host === 'localhost' ||
    host.startsWith('127.')
  ) {
    fail('PKI_CONFIGURATION_INVALID');
  }
  return host;
}

const runOpenSsl: PkiProcessRunner = async (executable, args) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      executable,
      [...args],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, shell: false },
      (error, stdout) => {
        if (error === null) resolvePromise({ stdout });
        else rejectPromise(error);
      },
    );
  });

async function runCommand(runner: PkiProcessRunner, args: readonly string[]): Promise<void> {
  try {
    await runner('openssl', args);
  } catch {
    fail('PKI_OPENSSL_FAILED');
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureWritableRoot(rootDirectory: string): Promise<void> {
  try {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    await access(rootDirectory, constants.W_OK);
  } catch {
    fail('PKI_ROOT_NOT_WRITABLE');
  }
}

async function inventoryState(rootDirectory: string): Promise<'empty' | 'complete' | 'partial'> {
  const present = await Promise.all(
    MATERIAL_IDS.map((id) => pathExists(join(rootDirectory, RUNNER_PKI_FILES[id]))),
  );
  const marker = await pathExists(join(rootDirectory, COMPLETE_MARKER));
  const count = present.filter(Boolean).length;
  if (count === 0 && !marker) return 'empty';
  if (count === MATERIAL_IDS.length && marker) return 'complete';
  return 'partial';
}

function publicKeyBytes(value: ReturnType<typeof createPublicKey>): Buffer {
  return value.export({ format: 'der', type: 'spki' });
}

function requireMatchingKey(certificate: X509Certificate, privateKeyPem: Buffer): void {
  const privatePublicKey = createPublicKey(createPrivateKey(privateKeyPem));
  if (!publicKeyBytes(certificate.publicKey).equals(publicKeyBytes(privatePublicKey))) {
    fail('PKI_INVALID');
  }
}

function requireCurrent(certificate: X509Certificate, now: number): void {
  const notBefore = Date.parse(certificate.validFrom);
  const notAfter = Date.parse(certificate.validTo);
  if (
    !Number.isFinite(notBefore) ||
    !Number.isFinite(notAfter) ||
    now < notBefore ||
    now >= notAfter
  ) {
    fail('PKI_INVALID');
  }
}

async function requireFileModes(rootDirectory: string): Promise<void> {
  for (const id of MATERIAL_IDS) {
    const mode = (await stat(join(rootDirectory, RUNNER_PKI_FILES[id]))).mode & 0o777;
    if (mode !== expectedMode(id)) fail('PKI_INVALID');
  }
}

async function validateInventory(input: {
  rootDirectory: string;
  ui4aHost: string;
  keycloakHost: string;
  postgresHost: string;
  postgresDnsNames: string[];
  edgeUid: number;
  edgeGid: number;
}): Promise<void> {
  try {
    const marker = JSON.parse(
      await readFile(join(input.rootDirectory, COMPLETE_MARKER), 'utf8'),
    ) as Record<string, unknown>;
    if (
      marker.schemaVersion !== 2 ||
      marker.ui4aHost !== input.ui4aHost ||
      marker.keycloakHost !== input.keycloakHost ||
      marker.postgresHost !== input.postgresHost ||
      JSON.stringify(marker.postgresDnsNames) !== JSON.stringify(input.postgresDnsNames)
    ) {
      fail('PKI_INVALID');
    }
    await requireFileModes(input.rootDirectory);
    for (const id of [
      'ui4aCertificate',
      'ui4aPrivateKey',
      'keycloakCertificate',
      'keycloakPrivateKey',
    ] as const) {
      const owner = await stat(join(input.rootDirectory, RUNNER_PKI_FILES[id]));
      if (owner.uid !== input.edgeUid || owner.gid !== input.edgeGid) fail('PKI_INVALID');
    }
    const now = Date.now();
    const root = new X509Certificate(
      await readFile(join(input.rootDirectory, RUNNER_PKI_FILES.rootCertificate)),
    );
    if (
      !root.ca ||
      root.subject !== `CN=${ROOT_COMMON_NAME}` ||
      root.issuer !== `CN=${ROOT_COMMON_NAME}` ||
      !root.verify(root.publicKey)
    ) {
      fail('PKI_INVALID');
    }
    requireCurrent(root, now);
    requireMatchingKey(
      root,
      await readFile(join(input.rootDirectory, RUNNER_PKI_FILES.rootPrivateKey)),
    );

    for (const [certificateId, privateKeyId, commonName, dnsNames] of [
      ['ui4aCertificate', 'ui4aPrivateKey', input.ui4aHost, [input.ui4aHost]],
      ['keycloakCertificate', 'keycloakPrivateKey', input.keycloakHost, [input.keycloakHost]],
      ['postgresCertificate', 'postgresPrivateKey', input.postgresHost, input.postgresDnsNames],
    ] as const) {
      const certificate = new X509Certificate(
        await readFile(join(input.rootDirectory, RUNNER_PKI_FILES[certificateId])),
      );
      if (
        certificate.ca ||
        certificate.subject !== `CN=${commonName}` ||
        certificate.issuer !== root.subject ||
        certificate.subjectAltName !== dnsNames.map((host) => `DNS:${host}`).join(', ') ||
        dnsNames.some((host) => certificate.checkHost(host) !== host) ||
        !certificate.verify(root.publicKey)
      ) {
        fail('PKI_INVALID');
      }
      requireCurrent(certificate, now);
      requireMatchingKey(
        certificate,
        await readFile(join(input.rootDirectory, RUNNER_PKI_FILES[privateKeyId])),
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'PKI_INVALID') throw error;
    fail('PKI_INVALID');
  }
}

async function generateLeaf(input: {
  runner: PkiProcessRunner;
  stageDirectory: string;
  directory: 'ui4a' | 'keycloak' | 'postgres';
  commonName: string;
  dnsNames: string[];
  certificateName?: string;
  privateKeyName?: string;
}): Promise<void> {
  const directory = join(input.stageDirectory, input.directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const privateKey = join(directory, input.privateKeyName ?? 'tls.key');
  const request = join(directory, 'tls.csr');
  const certificate = join(directory, input.certificateName ?? 'tls.crt');
  await runCommand(input.runner, [
    'genpkey',
    '-algorithm',
    'RSA',
    '-pkeyopt',
    'rsa_keygen_bits:2048',
    '-out',
    privateKey,
  ]);
  await runCommand(input.runner, [
    'req',
    '-new',
    '-sha256',
    '-key',
    privateKey,
    '-out',
    request,
    '-subj',
    `/CN=${input.commonName}`,
    '-addext',
    `subjectAltName=${input.dnsNames.map((host) => `DNS:${host}`).join(',')}`,
    '-addext',
    'basicConstraints=critical,CA:FALSE',
    '-addext',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext',
    'extendedKeyUsage=serverAuth',
  ]);
  await runCommand(input.runner, [
    'x509',
    '-req',
    '-sha256',
    '-days',
    '825',
    '-in',
    request,
    '-CA',
    join(input.stageDirectory, 'root-ca.crt'),
    '-CAkey',
    join(input.stageDirectory, 'root-ca.key'),
    '-CAcreateserial',
    '-copy_extensions',
    'copy',
    '-out',
    certificate,
  ]);
  await chmod(privateKey, 0o600);
  await chmod(certificate, 0o644);
}

async function generateStagedInventory(input: {
  runner: PkiProcessRunner;
  stageDirectory: string;
  ui4aHost: string;
  keycloakHost: string;
  postgresHost: string;
  postgresDnsNames: string[];
}): Promise<void> {
  const rootPrivateKey = join(input.stageDirectory, 'root-ca.key');
  const rootCertificate = join(input.stageDirectory, 'root-ca.crt');
  await runCommand(input.runner, [
    'genpkey',
    '-algorithm',
    'RSA',
    '-pkeyopt',
    'rsa_keygen_bits:2048',
    '-out',
    rootPrivateKey,
  ]);
  await runCommand(input.runner, [
    'req',
    '-x509',
    '-new',
    '-sha256',
    '-days',
    '3650',
    '-key',
    rootPrivateKey,
    '-out',
    rootCertificate,
    '-subj',
    `/CN=${ROOT_COMMON_NAME}`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  ]);
  await chmod(rootPrivateKey, 0o600);
  await chmod(rootCertificate, 0o644);
  await generateLeaf({
    runner: input.runner,
    stageDirectory: input.stageDirectory,
    directory: 'ui4a',
    commonName: input.ui4aHost,
    dnsNames: [input.ui4aHost],
  });
  await generateLeaf({
    runner: input.runner,
    stageDirectory: input.stageDirectory,
    directory: 'keycloak',
    commonName: input.keycloakHost,
    dnsNames: [input.keycloakHost],
  });
  await generateLeaf({
    runner: input.runner,
    stageDirectory: input.stageDirectory,
    directory: 'postgres',
    commonName: input.postgresHost,
    dnsNames: input.postgresDnsNames,
    certificateName: 'server.crt',
    privateKeyName: 'server.key',
  });
}

async function publishStagedInventory(input: {
  rootDirectory: string;
  stageDirectory: string;
  ui4aHost: string;
  keycloakHost: string;
  postgresHost: string;
  postgresDnsNames: string[];
  edgeUid: number;
  edgeGid: number;
}): Promise<void> {
  await mkdir(join(input.rootDirectory, 'ui4a'), { recursive: true, mode: 0o700 });
  await mkdir(join(input.rootDirectory, 'keycloak'), { recursive: true, mode: 0o700 });
  await mkdir(join(input.rootDirectory, 'postgres'), { recursive: true, mode: 0o700 });
  for (const id of MATERIAL_IDS) {
    await rename(
      join(input.stageDirectory, RUNNER_PKI_FILES[id]),
      join(input.rootDirectory, RUNNER_PKI_FILES[id]),
    );
  }
  for (const directory of ['ui4a', 'keycloak']) {
    await chown(join(input.rootDirectory, directory), input.edgeUid, input.edgeGid);
  }
  for (const id of [
    'ui4aCertificate',
    'ui4aPrivateKey',
    'keycloakCertificate',
    'keycloakPrivateKey',
  ] as const) {
    await chown(join(input.rootDirectory, RUNNER_PKI_FILES[id]), input.edgeUid, input.edgeGid);
  }
  await chmod(input.rootDirectory, 0o755);
  const markerTemp = join(input.rootDirectory, `${COMPLETE_MARKER}.tmp`);
  await writeFile(
    markerTemp,
    `${JSON.stringify({
      schemaVersion: 2,
      ui4aHost: input.ui4aHost,
      keycloakHost: input.keycloakHost,
      postgresHost: input.postgresHost,
      postgresDnsNames: input.postgresDnsNames,
    })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o644 },
  );
  await rename(markerTemp, join(input.rootDirectory, COMPLETE_MARKER));
}

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
