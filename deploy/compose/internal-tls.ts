export type ComposeTlsMaterialId =
  | 'rootCertificate'
  | 'rootPrivateKey'
  | 'ui4aCertificate'
  | 'ui4aPrivateKey'
  | 'keycloakCertificate'
  | 'keycloakPrivateKey';

export interface ComposeTlsStoredMaterial {
  bytes: string;
  mode: 0o600 | 0o644;
}

export interface ComposeTlsCertificateFacts {
  commonName: string;
  issuerCommonName: string;
  dnsNames: string[];
  notBefore: string;
  notAfter: string;
  publicKeyFingerprint: string;
  isCertificateAuthority: boolean;
}

export interface ComposeTlsPkiAdapter {
  generateRoot(input: { commonName: 'UI4A Experimental Internal CA'; now: string }): {
    certificate: string;
    privateKey: string;
  };
  generateLeaf(input: {
    host: string;
    issuerCertificate: string;
    issuerPrivateKey: string;
    now: string;
  }): { certificate: string; privateKey: string };
  inspectCertificate(certificate: string): ComposeTlsCertificateFacts;
  privateKeyFingerprint(privateKey: string): string;
  verifyIssuedBy(input: { certificate: string; rootCertificate: string }): boolean;
}

export interface ComposeInternalTlsSettings {
  service: { publicOrigin: string };
  auth: { oidc: { issuer: string; callbackUrl: string } };
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
  temporal: { transport: { mode: 'tls'; caCertificatePath: string } };
}

export interface ComposeInternalTlsPlan {
  disposition: 'initialized' | 'reused';
  material: Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial>;
  writes: Array<{
    id: ComposeTlsMaterialId;
    path: string;
    bytes: string;
    mode: 0o600 | 0o644;
  }>;
  volume: {
    name: 'experiment-ca';
    mountPath: '/var/lib/ui4a/ca';
    retainOnOrdinaryDown: true;
  };
  clientTrust: { certificatePath: string; alias: 'ui4a-experiment-root' };
  trustRefs: { ui4a: string; keycloak: string; postgres: string; temporal: string };
  oidc: { issuer: string; callbackUrl: string; postLogoutRedirectUri: string };
  backup: { artifactRef: 'private/pki.tar'; allowlist: string[] };
  publicEvidence: {
    materialIncluded: false;
    certificateIds: Array<'ui4aCertificate' | 'keycloakCertificate'>;
  };
}

const ROOT_COMMON_NAME = 'UI4A Experimental Internal CA' as const;

const MATERIAL_PATHS: Record<ComposeTlsMaterialId, string> = {
  rootCertificate: '/var/lib/ui4a/ca/root-ca.crt',
  rootPrivateKey: '/var/lib/ui4a/ca/root-ca.key',
  ui4aCertificate: '/var/lib/ui4a/ca/ui4a/tls.crt',
  ui4aPrivateKey: '/var/lib/ui4a/ca/ui4a/tls.key',
  keycloakCertificate: '/var/lib/ui4a/ca/keycloak/tls.crt',
  keycloakPrivateKey: '/var/lib/ui4a/ca/keycloak/tls.key',
};

const MATERIAL_IDS = Object.keys(MATERIAL_PATHS) as ComposeTlsMaterialId[];

function fail(code: string): never {
  throw new Error(code);
}

function parseTime(value: string, code: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail(code);
  return time;
}

function requireExactOrigins(settings: ComposeInternalTlsSettings): void {
  const ui4aOrigin = `https://${settings.tls.ui4aHost}`;
  const keycloakOrigin = `https://${settings.tls.keycloakHost}`;
  const issuer = `${keycloakOrigin}/realms/${settings.keycloak.realm}`;
  const callbackUrl = `${ui4aOrigin}/api/auth/callback`;

  if (
    settings.service.publicOrigin !== ui4aOrigin ||
    settings.keycloak.host !== settings.tls.keycloakHost ||
    settings.auth.oidc.issuer !== issuer ||
    settings.auth.oidc.callbackUrl !== callbackUrl
  ) {
    fail('COMPOSE_TLS_ORIGIN_MISMATCH');
  }
}

function requireCanonicalPathsAndTrust(settings: ComposeInternalTlsSettings): void {
  if (
    settings.tls.caCertificatePath !== MATERIAL_PATHS.rootCertificate ||
    settings.tls.ui4aCertificatePath !== MATERIAL_PATHS.ui4aCertificate ||
    settings.tls.ui4aPrivateKeyPath !== MATERIAL_PATHS.ui4aPrivateKey ||
    settings.tls.keycloakCertificatePath !== MATERIAL_PATHS.keycloakCertificate ||
    settings.tls.keycloakPrivateKeyPath !== MATERIAL_PATHS.keycloakPrivateKey ||
    settings.postgres.tls.caCertificatePath !== MATERIAL_PATHS.rootCertificate ||
    settings.temporal.transport.mode !== 'tls' ||
    settings.temporal.transport.caCertificatePath !== MATERIAL_PATHS.rootCertificate
  ) {
    fail('COMPOSE_TLS_TRUST_MISMATCH');
  }
}

function requireFileModes(material: Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial>): void {
  for (const id of MATERIAL_IDS) {
    const expected = id.endsWith('PrivateKey') ? 0o600 : 0o644;
    if (material[id].mode !== expected) fail('COMPOSE_TLS_FILE_MODE_INVALID');
  }
}

function requireCurrentCertificate(
  facts: ComposeTlsCertificateFacts,
  now: number,
  code = 'COMPOSE_TLS_CERT_EXPIRED',
): void {
  const notBefore = parseTime(facts.notBefore, code);
  const notAfter = parseTime(facts.notAfter, code);
  if (now < notBefore || now >= notAfter) fail(code);
}

function requireMatchingKey(
  certificate: ComposeTlsCertificateFacts,
  privateKey: ComposeTlsStoredMaterial,
  pki: ComposeTlsPkiAdapter,
): void {
  if (certificate.publicKeyFingerprint !== pki.privateKeyFingerprint(privateKey.bytes)) {
    fail('COMPOSE_TLS_KEY_MISMATCH');
  }
}

function validateMaterial(input: {
  material: Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial>;
  settings: ComposeInternalTlsSettings;
  now: string;
  pki: ComposeTlsPkiAdapter;
}): void {
  const { material, settings, pki } = input;
  const now = parseTime(input.now, 'COMPOSE_TLS_TIME_INVALID');
  requireFileModes(material);

  const root = pki.inspectCertificate(material.rootCertificate.bytes);
  if (
    !root.isCertificateAuthority ||
    root.commonName !== ROOT_COMMON_NAME ||
    root.issuerCommonName !== ROOT_COMMON_NAME
  ) {
    fail('COMPOSE_TLS_ROOT_INVALID');
  }
  requireCurrentCertificate(root, now, 'COMPOSE_TLS_ROOT_INVALID');
  requireMatchingKey(root, material.rootPrivateKey, pki);

  const leaves = [
    {
      host: settings.tls.ui4aHost,
      certificate: material.ui4aCertificate,
      privateKey: material.ui4aPrivateKey,
    },
    {
      host: settings.tls.keycloakHost,
      certificate: material.keycloakCertificate,
      privateKey: material.keycloakPrivateKey,
    },
  ];

  for (const leaf of leaves) {
    const facts = pki.inspectCertificate(leaf.certificate.bytes);
    if (
      facts.isCertificateAuthority ||
      facts.commonName !== leaf.host ||
      facts.dnsNames.length !== 1 ||
      facts.dnsNames[0] !== leaf.host
    ) {
      fail('COMPOSE_TLS_SAN_MISMATCH');
    }
    requireCurrentCertificate(facts, now);
    if (
      facts.issuerCommonName !== ROOT_COMMON_NAME ||
      !pki.verifyIssuedBy({
        certificate: leaf.certificate.bytes,
        rootCertificate: material.rootCertificate.bytes,
      })
    ) {
      fail('COMPOSE_TLS_CHAIN_INVALID');
    }
    requireMatchingKey(facts, leaf.privateKey, pki);
  }
}

function initializeMaterial(input: {
  settings: ComposeInternalTlsSettings;
  now: string;
  pki: ComposeTlsPkiAdapter;
}): Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial> {
  const root = input.pki.generateRoot({ commonName: ROOT_COMMON_NAME, now: input.now });
  const ui4a = input.pki.generateLeaf({
    host: input.settings.tls.ui4aHost,
    issuerCertificate: root.certificate,
    issuerPrivateKey: root.privateKey,
    now: input.now,
  });
  const keycloak = input.pki.generateLeaf({
    host: input.settings.tls.keycloakHost,
    issuerCertificate: root.certificate,
    issuerPrivateKey: root.privateKey,
    now: input.now,
  });
  return {
    rootCertificate: { bytes: root.certificate, mode: 0o644 },
    rootPrivateKey: { bytes: root.privateKey, mode: 0o600 },
    ui4aCertificate: { bytes: ui4a.certificate, mode: 0o644 },
    ui4aPrivateKey: { bytes: ui4a.privateKey, mode: 0o600 },
    keycloakCertificate: { bytes: keycloak.certificate, mode: 0o644 },
    keycloakPrivateKey: { bytes: keycloak.privateKey, mode: 0o600 },
  };
}

function basePlan(
  settings: ComposeInternalTlsSettings,
  material: Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial>,
): Omit<ComposeInternalTlsPlan, 'disposition' | 'writes'> {
  return {
    material,
    volume: {
      name: 'experiment-ca',
      mountPath: '/var/lib/ui4a/ca',
      retainOnOrdinaryDown: true,
    },
    clientTrust: {
      certificatePath: MATERIAL_PATHS.rootCertificate,
      alias: 'ui4a-experiment-root',
    },
    trustRefs: {
      ui4a: MATERIAL_PATHS.rootCertificate,
      keycloak: MATERIAL_PATHS.rootCertificate,
      postgres: MATERIAL_PATHS.rootCertificate,
      temporal: MATERIAL_PATHS.rootCertificate,
    },
    oidc: {
      issuer: settings.auth.oidc.issuer,
      callbackUrl: settings.auth.oidc.callbackUrl,
      postLogoutRedirectUri: `${settings.service.publicOrigin}/*`,
    },
    backup: {
      artifactRef: 'private/pki.tar',
      allowlist: Object.values(MATERIAL_PATHS),
    },
    publicEvidence: {
      materialIncluded: false,
      certificateIds: ['ui4aCertificate', 'keycloakCertificate'],
    },
  };
}

/**
 * Reconcile the bounded experimental Compose PKI inventory without performing I/O.
 * Empty storage produces one write plan; complete valid storage is reused without mutation.
 */
export function reconcileComposeInternalTls(input: {
  now: string;
  settings: ComposeInternalTlsSettings;
  existing: Partial<Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial>>;
  pki: ComposeTlsPkiAdapter;
}): ComposeInternalTlsPlan {
  requireExactOrigins(input.settings);
  requireCanonicalPathsAndTrust(input.settings);

  const present = MATERIAL_IDS.filter((id) => input.existing[id] !== undefined);
  if (present.length !== 0 && present.length !== MATERIAL_IDS.length) {
    fail('COMPOSE_TLS_PARTIAL_STATE');
  }

  if (present.length === MATERIAL_IDS.length) {
    const material = Object.fromEntries(
      MATERIAL_IDS.map((id) => [id, { ...input.existing[id]! }]),
    ) as Record<ComposeTlsMaterialId, ComposeTlsStoredMaterial>;
    validateMaterial({ material, settings: input.settings, now: input.now, pki: input.pki });
    return {
      disposition: 'reused',
      writes: [],
      ...basePlan(input.settings, material),
    };
  }

  const material = initializeMaterial(input);
  validateMaterial({ material, settings: input.settings, now: input.now, pki: input.pki });
  return {
    disposition: 'initialized',
    writes: MATERIAL_IDS.map((id) => ({ id, path: MATERIAL_PATHS[id], ...material[id] })),
    ...basePlan(input.settings, material),
  };
}
