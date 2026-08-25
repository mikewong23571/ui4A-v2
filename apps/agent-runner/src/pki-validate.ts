import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  COMPLETE_MARKER,
  expectedMode,
  fail,
  MATERIAL_IDS,
  ROOT_COMMON_NAME,
  RUNNER_PKI_FILES,
} from './pki-inventory.js';

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

export async function validateInventory(input: {
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
