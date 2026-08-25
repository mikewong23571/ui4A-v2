import { chmod, chown, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  COMPLETE_MARKER,
  MATERIAL_IDS,
  ROOT_COMMON_NAME,
  runCommand,
  RUNNER_PKI_FILES,
  type PkiProcessRunner,
} from './pki-inventory.js';

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

export async function generateStagedInventory(input: {
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

export async function publishStagedInventory(input: {
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
