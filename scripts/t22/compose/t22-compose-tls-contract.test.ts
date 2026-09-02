import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const modulePath = 'deploy/compose/internal-tls.ts';
const contractPath = 'deploy/compose/internal-tls-contract.json';

type MaterialId =
  | 'rootCertificate'
  | 'rootPrivateKey'
  | 'ui4aCertificate'
  | 'ui4aPrivateKey'
  | 'keycloakCertificate'
  | 'keycloakPrivateKey';

interface StoredMaterial {
  bytes: string;
  mode: 0o600 | 0o644;
}

interface CertificateFacts {
  commonName: string;
  issuerCommonName: string;
  dnsNames: string[];
  notBefore: string;
  notAfter: string;
  publicKeyFingerprint: string;
  isCertificateAuthority: boolean;
}

interface GeneratedPair {
  certificate: string;
  privateKey: string;
}

interface PkiAdapter {
  generateRoot(input: { commonName: 'UI4A Experimental Internal CA'; now: string }): GeneratedPair;
  generateLeaf(input: {
    host: string;
    issuerCertificate: string;
    issuerPrivateKey: string;
    now: string;
  }): GeneratedPair;
  inspectCertificate(certificate: string): CertificateFacts;
  privateKeyFingerprint(privateKey: string): string;
  verifyIssuedBy(input: { certificate: string; rootCertificate: string }): boolean;
}

interface ComposeTlsSettings {
  service: { publicOrigin: string; trustedRequestOrigins: string[] };
  auth: {
    oidc: {
      issuer: string;
      callbackUrl: string;
    };
  };
  keycloak: { host: string; realm: 'ui4a' };
  tls: {
    ui4aHost: string;
    keycloakHost: string;
    caCertificatePath: string;
    ui4aCertificatePath: string;
    ui4aPrivateKeyPath: string;
    keycloakCertificatePath: string;
    keycloakPrivateKeyPath: string;
  };
  postgres: { tls: { caCertificatePath: string } };
  temporal: {
    transport: { mode: 'tls'; caCertificatePath: string };
  };
}

interface ComposeTlsPlan {
  disposition: 'initialized' | 'reused';
  material: Record<MaterialId, StoredMaterial>;
  writes: Array<{ id: MaterialId; path: string; bytes: string; mode: 0o600 | 0o644 }>;
  volume: {
    name: 'experiment-ca';
    mountPath: '/var/lib/ui4a/ca';
    retainOnOrdinaryDown: true;
  };
  clientTrust: {
    certificatePath: string;
    alias: 'ui4a-experiment-root';
  };
  trustRefs: {
    ui4a: string;
    keycloak: string;
    postgres: string;
    temporal: string;
  };
  oidc: {
    issuer: string;
    callbackUrl: string;
    postLogoutRedirectUri: string;
  };
  backup: {
    artifactRef: 'private/pki.tar';
    allowlist: string[];
  };
  publicEvidence: {
    materialIncluded: false;
    certificateIds: Array<'ui4aCertificate' | 'keycloakCertificate'>;
  };
}

interface ComposeTlsModule {
  reconcileComposeInternalTls(input: {
    now: string;
    settings: ComposeTlsSettings;
    existing: Partial<Record<MaterialId, StoredMaterial>>;
    pki: PkiAdapter;
  }): ComposeTlsPlan;
}

interface ComposeTlsContract {
  schemaVersion: 1;
  volume: ComposeTlsPlan['volume'];
  files: Record<MaterialId, { path: string; mode: 0o600 | 0o644 }>;
  hostRefs: {
    ui4a: 'settings.tls.ui4aHost';
    keycloak: 'settings.tls.keycloakHost';
  };
  trustRefs: {
    ui4a: 'settings.tls.caCertificatePath';
    keycloak: 'settings.tls.caCertificatePath';
    postgres: 'settings.postgres.tls.caCertificatePath';
    temporal: 'settings.temporal.transport.caCertificatePath';
  };
  backup: ComposeTlsPlan['backup'];
  publicEvidence: ComposeTlsPlan['publicEvidence'];
}

const paths: Record<MaterialId, string> = {
  rootCertificate: '/var/lib/ui4a/ca/root-ca.crt',
  rootPrivateKey: '/var/lib/ui4a/ca/root-ca.key',
  ui4aCertificate: '/var/lib/ui4a/ca/ui4a/tls.crt',
  ui4aPrivateKey: '/var/lib/ui4a/ca/ui4a/tls.key',
  keycloakCertificate: '/var/lib/ui4a/ca/keycloak/tls.crt',
  keycloakPrivateKey: '/var/lib/ui4a/ca/keycloak/tls.key',
};

const validMaterial: Record<MaterialId, StoredMaterial> = {
  rootCertificate: { bytes: '__root_certificate_bytes__', mode: 0o644 },
  rootPrivateKey: { bytes: '__root_private_key_bytes__', mode: 0o600 },
  ui4aCertificate: { bytes: '__ui4a_certificate_bytes__', mode: 0o644 },
  ui4aPrivateKey: { bytes: '__ui4a_private_key_bytes__', mode: 0o600 },
  keycloakCertificate: { bytes: '__keycloak_certificate_bytes__', mode: 0o644 },
  keycloakPrivateKey: { bytes: '__keycloak_private_key_bytes__', mode: 0o600 },
};

function settings(): ComposeTlsSettings {
  return {
    service: {
      publicOrigin: 'https://ui4a.mothership.internal',
      trustedRequestOrigins: ['https://ui4a.mothership.internal'],
    },
    auth: {
      oidc: {
        issuer: 'https://auth.ui4a.mothership.internal/realms/ui4a',
        callbackUrl: 'https://ui4a.mothership.internal/api/auth/callback',
      },
    },
    keycloak: { host: 'auth.ui4a.mothership.internal', realm: 'ui4a' },
    tls: {
      ui4aHost: 'ui4a.mothership.internal',
      keycloakHost: 'auth.ui4a.mothership.internal',
      caCertificatePath: paths.rootCertificate,
      ui4aCertificatePath: paths.ui4aCertificate,
      ui4aPrivateKeyPath: paths.ui4aPrivateKey,
      keycloakCertificatePath: paths.keycloakCertificate,
      keycloakPrivateKeyPath: paths.keycloakPrivateKey,
    },
    postgres: { tls: { caCertificatePath: paths.rootCertificate } },
    temporal: { transport: { mode: 'tls', caCertificatePath: paths.rootCertificate } },
  };
}

function certificateFacts(
  commonName: string,
  publicKeyFingerprint: string,
  overrides: Partial<CertificateFacts> = {},
): CertificateFacts {
  return {
    commonName,
    issuerCommonName: 'UI4A Experimental Internal CA',
    dnsNames: commonName === 'UI4A Experimental Internal CA' ? [] : [commonName],
    notBefore: '2026-08-23T00:00:00.000Z',
    notAfter: '2036-08-23T00:00:00.000Z',
    publicKeyFingerprint,
    isCertificateAuthority: commonName === 'UI4A Experimental Internal CA',
    ...overrides,
  };
}

function pkiAdapter(
  overrides: {
    facts?: Partial<Record<MaterialId, Partial<CertificateFacts>>>;
    privateKeyFingerprints?: Partial<Record<MaterialId, string>>;
    invalidChains?: MaterialId[];
  } = {},
): PkiAdapter {
  const factsByBytes: Record<string, CertificateFacts> = {
    [validMaterial.rootCertificate.bytes]: certificateFacts(
      'UI4A Experimental Internal CA',
      'root-key',
      overrides.facts?.rootCertificate,
    ),
    [validMaterial.ui4aCertificate.bytes]: certificateFacts(
      'ui4a.mothership.internal',
      'ui4a-key',
      overrides.facts?.ui4aCertificate,
    ),
    [validMaterial.keycloakCertificate.bytes]: certificateFacts(
      'auth.ui4a.mothership.internal',
      'keycloak-key',
      overrides.facts?.keycloakCertificate,
    ),
  };
  const keyIdsByBytes: Record<string, MaterialId> = {
    [validMaterial.rootPrivateKey.bytes]: 'rootPrivateKey',
    [validMaterial.ui4aPrivateKey.bytes]: 'ui4aPrivateKey',
    [validMaterial.keycloakPrivateKey.bytes]: 'keycloakPrivateKey',
  };
  const certificateIdsByBytes: Record<string, MaterialId> = {
    [validMaterial.rootCertificate.bytes]: 'rootCertificate',
    [validMaterial.ui4aCertificate.bytes]: 'ui4aCertificate',
    [validMaterial.keycloakCertificate.bytes]: 'keycloakCertificate',
  };

  return {
    generateRoot: vi.fn(() => ({
      certificate: validMaterial.rootCertificate.bytes,
      privateKey: validMaterial.rootPrivateKey.bytes,
    })),
    generateLeaf: vi.fn(({ host }) =>
      host === 'ui4a.mothership.internal'
        ? {
            certificate: validMaterial.ui4aCertificate.bytes,
            privateKey: validMaterial.ui4aPrivateKey.bytes,
          }
        : {
            certificate: validMaterial.keycloakCertificate.bytes,
            privateKey: validMaterial.keycloakPrivateKey.bytes,
          },
    ),
    inspectCertificate: vi.fn((certificate) => factsByBytes[certificate]!),
    privateKeyFingerprint: vi.fn((privateKey) => {
      const id = keyIdsByBytes[privateKey];
      const defaults: Partial<Record<MaterialId, string>> = {
        rootPrivateKey: 'root-key',
        ui4aPrivateKey: 'ui4a-key',
        keycloakPrivateKey: 'keycloak-key',
      };
      return overrides.privateKeyFingerprints?.[id] ?? defaults[id]!;
    }),
    verifyIssuedBy: vi.fn(({ certificate }) => {
      const id = certificateIdsByBytes[certificate];
      return !overrides.invalidChains?.includes(id);
    }),
  };
}

async function plannedApi(): Promise<ComposeTlsModule> {
  const absolutePath = resolve(repositoryRoot, modulePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 Compose TLS module: ${modulePath}`);
  }
  return import(pathToFileURL(absolutePath).href) as Promise<ComposeTlsModule>;
}

function plannedContract(): ComposeTlsContract {
  const absolutePath = resolve(repositoryRoot, contractPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 Compose TLS artifact: ${contractPath}`);
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as ComposeTlsContract;
}

describe('T22 Compose persistent internal TLS contract', () => {
  it('fixes one retained volume, six paths, and private-key file modes', () => {
    const contract = plannedContract();

    expect(contract).toMatchObject({
      schemaVersion: 1,
      volume: {
        name: 'experiment-ca',
        mountPath: '/var/lib/ui4a/ca',
        retainOnOrdinaryDown: true,
      },
      files: Object.fromEntries(
        Object.entries(paths).map(([id, path]) => [
          id,
          { path, mode: id.endsWith('PrivateKey') ? 0o600 : 0o644 },
        ]),
      ),
      hostRefs: {
        ui4a: 'settings.tls.ui4aHost',
        keycloak: 'settings.tls.keycloakHost',
      },
    });
  });

  it('initializes one root and exactly two host-specific leaf pairs on an empty volume', async () => {
    const { reconcileComposeInternalTls } = await plannedApi();
    const pki = pkiAdapter();

    const plan = reconcileComposeInternalTls({
      now: '2026-08-24T00:00:00.000Z',
      settings: settings(),
      existing: {},
      pki,
    });

    expect(plan.disposition).toBe('initialized');
    expect(pki.generateRoot).toHaveBeenCalledTimes(1);
    expect(pki.generateLeaf).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ host: 'ui4a.mothership.internal' }),
    );
    expect(pki.generateLeaf).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ host: 'auth.ui4a.mothership.internal' }),
    );
    expect(plan.writes).toEqual(
      (Object.keys(validMaterial) as MaterialId[]).map((id) => ({
        id,
        path: paths[id],
        ...validMaterial[id],
      })),
    );
  });

  it('reuses a complete valid volume byte-for-byte and performs zero writes or generation', async () => {
    const { reconcileComposeInternalTls } = await plannedApi();
    const pki = pkiAdapter();
    const originalBytes = Object.fromEntries(
      Object.entries(validMaterial).map(([id, value]) => [id, value.bytes]),
    );

    const plan = reconcileComposeInternalTls({
      now: '2026-08-24T00:00:00.000Z',
      settings: settings(),
      existing: validMaterial,
      pki,
    });

    expect(plan.disposition).toBe('reused');
    expect(plan.writes).toEqual([]);
    expect(pki.generateRoot).not.toHaveBeenCalled();
    expect(pki.generateLeaf).not.toHaveBeenCalled();
    expect(
      Object.fromEntries(Object.entries(plan.material).map(([id, value]) => [id, value.bytes])),
    ).toEqual(originalBytes);
  });

  it('fails closed instead of filling a partial volume or rotating material implicitly', async () => {
    const { reconcileComposeInternalTls } = await plannedApi();

    expect(() =>
      reconcileComposeInternalTls({
        now: '2026-08-24T00:00:00.000Z',
        settings: settings(),
        existing: { rootCertificate: validMaterial.rootCertificate },
        pki: pkiAdapter(),
      }),
    ).toThrowError('COMPOSE_TLS_PARTIAL_STATE');
  });

  it('fails closed when retained private-key permissions are broader than owner-only', async () => {
    const { reconcileComposeInternalTls } = await plannedApi();

    expect(() =>
      reconcileComposeInternalTls({
        now: '2026-08-24T00:00:00.000Z',
        settings: settings(),
        existing: {
          ...validMaterial,
          rootPrivateKey: { ...validMaterial.rootPrivateKey, mode: 0o644 },
        },
        pki: pkiAdapter(),
      }),
    ).toThrowError('COMPOSE_TLS_FILE_MODE_INVALID');
  });

  it.each([
    {
      name: 'root is not a CA',
      adapter: () => pkiAdapter({ facts: { rootCertificate: { isCertificateAuthority: false } } }),
      code: 'COMPOSE_TLS_ROOT_INVALID',
    },
    {
      name: 'leaf SAN differs from its canonical host',
      adapter: () => pkiAdapter({ facts: { ui4aCertificate: { dnsNames: ['wrong.internal'] } } }),
      code: 'COMPOSE_TLS_SAN_MISMATCH',
    },
    {
      name: 'leaf is expired',
      adapter: () =>
        pkiAdapter({
          facts: { keycloakCertificate: { notAfter: '2026-08-23T00:00:00.000Z' } },
        }),
      code: 'COMPOSE_TLS_CERT_EXPIRED',
    },
    {
      name: 'leaf chain does not terminate at the persisted root',
      adapter: () => pkiAdapter({ invalidChains: ['keycloakCertificate'] }),
      code: 'COMPOSE_TLS_CHAIN_INVALID',
    },
    {
      name: 'certificate does not match its persisted private key',
      adapter: () => pkiAdapter({ privateKeyFingerprints: { ui4aPrivateKey: 'different-key' } }),
      code: 'COMPOSE_TLS_KEY_MISMATCH',
    },
  ])('fails closed when $name', async ({ adapter, code }) => {
    const { reconcileComposeInternalTls } = await plannedApi();

    expect(() =>
      reconcileComposeInternalTls({
        now: '2026-08-24T00:00:00.000Z',
        settings: settings(),
        existing: validMaterial,
        pki: adapter(),
      }),
    ).toThrowError(code);
  });

  it('requires canonical UI4A, Keycloak, PostgreSQL, and Temporal trust refs to one root', async () => {
    const contract = plannedContract();
    const { reconcileComposeInternalTls } = await plannedApi();
    const plan = reconcileComposeInternalTls({
      now: '2026-08-24T00:00:00.000Z',
      settings: settings(),
      existing: validMaterial,
      pki: pkiAdapter(),
    });

    expect(contract.trustRefs).toEqual({
      ui4a: 'settings.tls.caCertificatePath',
      keycloak: 'settings.tls.caCertificatePath',
      postgres: 'settings.postgres.tls.caCertificatePath',
      temporal: 'settings.temporal.transport.caCertificatePath',
    });
    expect(new Set(Object.values(plan.trustRefs))).toEqual(new Set([paths.rootCertificate]));
    expect(plan.clientTrust).toEqual({
      certificatePath: paths.rootCertificate,
      alias: 'ui4a-experiment-root',
    });
  });

  it('binds issuer, callback, and post-logout redirect to exact canonical HTTPS origins', async () => {
    const { reconcileComposeInternalTls } = await plannedApi();
    const plan = reconcileComposeInternalTls({
      now: '2026-08-24T00:00:00.000Z',
      settings: settings(),
      existing: validMaterial,
      pki: pkiAdapter(),
    });

    expect(plan.oidc).toEqual({
      issuer: 'https://auth.ui4a.mothership.internal/realms/ui4a',
      callbackUrl: 'https://ui4a.mothership.internal/api/auth/callback',
      postLogoutRedirectUri: 'https://ui4a.mothership.internal/*',
    });
    expect(new URL(plan.oidc.issuer).origin).toBe('https://auth.ui4a.mothership.internal');
    expect(new URL(plan.oidc.callbackUrl).origin).toBe('https://ui4a.mothership.internal');
    expect(plan.oidc.issuer).not.toMatch(/^http:/);
    expect(plan.oidc.callbackUrl).not.toMatch(/^http:/);
  });

  it.each([
    [
      'service origin',
      (value: ComposeTlsSettings) =>
        (value.service.publicOrigin = 'http://ui4a.mothership.internal'),
    ],
    [
      'OIDC issuer host',
      (value: ComposeTlsSettings) =>
        (value.auth.oidc.issuer = 'https://wrong.internal/realms/ui4a'),
    ],
    [
      'callback origin',
      (value: ComposeTlsSettings) =>
        (value.auth.oidc.callbackUrl = 'https://wrong.internal/api/auth/callback'),
    ],
  ])('fails closed for a non-canonical %s', async (_name, mutate) => {
    const { reconcileComposeInternalTls } = await plannedApi();
    const candidate = settings();
    mutate(candidate);

    expect(() =>
      reconcileComposeInternalTls({
        now: '2026-08-24T00:00:00.000Z',
        settings: candidate,
        existing: validMaterial,
        pki: pkiAdapter(),
      }),
    ).toThrowError('COMPOSE_TLS_ORIGIN_MISMATCH');
  });

  it('allows all private material only in the direct backup and never in public evidence', async () => {
    const contract = plannedContract();
    const { reconcileComposeInternalTls } = await plannedApi();
    const plan = reconcileComposeInternalTls({
      now: '2026-08-24T00:00:00.000Z',
      settings: settings(),
      existing: validMaterial,
      pki: pkiAdapter(),
    });

    expect(contract.backup).toEqual({
      artifactRef: 'private/pki.tar',
      allowlist: Object.values(paths),
    });
    expect(plan.backup).toEqual(contract.backup);
    expect(plan.publicEvidence).toEqual({
      materialIncluded: false,
      certificateIds: ['ui4aCertificate', 'keycloakCertificate'],
    });
    expect(JSON.stringify(plan.publicEvidence)).not.toContain('root');
    expect(JSON.stringify(plan.publicEvidence)).not.toContain('PrivateKey');
    for (const { bytes } of Object.values(validMaterial)) {
      expect(JSON.stringify(plan.publicEvidence)).not.toContain(bytes);
    }
  });
});
