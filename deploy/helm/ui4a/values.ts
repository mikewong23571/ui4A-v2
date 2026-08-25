import { isIP } from 'node:net';

export type KubernetesObject = Record<string, unknown> & {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
};

const imageKeys = [
  'postgres',
  'temporal',
  'temporalAdminTools',
  'temporalUi',
  'keycloak',
  'web',
  'worker',
  'runner',
  'adminWorker',
  'pkiRunner',
] as const;
export const serviceAccountKeys = [
  'postgres',
  'temporal',
  'keycloak',
  'web',
  'worker',
  'runner',
  'admin',
  'backup',
] as const;
export const volumeKeys = ['postgres', 'runtime', 'backup', 'pki'] as const;

type ImageKey = (typeof imageKeys)[number];
type ServiceAccountKey = (typeof serviceAccountKeys)[number];
type VolumeKey = (typeof volumeKeys)[number];

interface DynamicStorage {
  mode: 'dynamic';
  storageClassName: string;
  sizes: Record<VolumeKey, string>;
}

interface StaticVolume {
  volumeName: string;
  capacity: string;
  hostPath: string;
  nodeName: string;
}

interface StaticStorage {
  mode: 'static';
  volumes: Record<VolumeKey, StaticVolume>;
}

export interface Ui4aHelmValues {
  schemaVersion: 1;
  namespace: { create: true; name: string; istioInjection: true };
  experimental: { highAvailability: false; replicas: 1 };
  scheduling: { nodeSelector: Record<string, string> };
  network: { hostAliases: Array<{ ip: string; hostnames: string[] }> };
  hosts: { web: string; keycloak: string };
  images: Record<ImageKey, string>;
  imagePullPolicy: 'IfNotPresent';
  serviceAccounts: Record<ServiceAccountKey, string>;
  secrets: {
    existingSecretName: string;
    runnerExistingSecretName: string;
    runnerSecretsKey: string;
  };
  storage: DynamicStorage | StaticStorage;
  backup: { schedule: string };
  istio: {
    gateway: string;
    tlsCredentialName: string;
    oidcIssuer: string;
    oidcAudience: string;
    jwksUri: string;
  };
}

export interface RenderResult {
  resources: KubernetesObject[];
  evidence: {
    schemaVersion: 1;
    resourceRefs: Array<{
      apiVersion: string;
      kind: string;
      namespace?: string;
      name: string;
    }>;
    valuesHash: string;
  };
}

export type UnknownRecord = Record<string, unknown>;

function fail(path: string, reason: string): never {
  throw new Error(`${path}: ${reason}`);
}

function object(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be an object');
  }
  return value as UnknownRecord;
}

function exactObject(value: unknown, path: string, keys: readonly string[]): UnknownRecord {
  const candidate = object(value, path);
  const unexpected = Object.keys(candidate).find((key) => !keys.includes(key));
  if (unexpected !== undefined) fail(`${path}.${unexpected}`, 'unknown field');
  const missing = keys.find((key) => !(key in candidate));
  if (missing !== undefined) fail(`${path}.${missing}`, 'is required');
  return candidate;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    return fail(path, 'must be a non-empty string');
  }
  return value;
}

function dnsName(value: unknown, path: string): string {
  const result = string(value, path).toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(result) ||
    result.includes('..') ||
    result.includes(':')
  ) {
    fail(path, 'must be a DNS name');
  }
  return result;
}

function name(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(result) || result.length > 63) {
    fail(path, 'must be a Kubernetes name');
  }
  return result;
}

function secretKey(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^[A-Za-z0-9._-]+$/.test(result) || result.length > 253) {
    fail(path, 'must be a Kubernetes Secret data key');
  }
  return result;
}

function exactLiteral<T>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path, `must be ${String(expected)}`);
  return expected;
}

function digestImage(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\S+@sha256:[a-f0-9]{64}$/.test(result)) fail(path, 'must be pinned by sha256 digest');
  return result;
}

function quantity(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^[1-9]\d*(?:Ki|Mi|Gi|Ti)$/.test(result)) fail(path, 'must be a positive binary quantity');
  return result;
}

function absolutePath(value: unknown, path: string): string {
  const result = string(value, path);
  if (!result.startsWith('/') || result === '/' || result.includes('/../')) {
    fail(path, 'must be a non-root absolute path');
  }
  return result;
}

function httpsUrl(value: unknown, path: string): string {
  const result = string(value, path);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    return fail(path, 'must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    fail(path, 'must be an absolute HTTPS URL without credentials');
  }
  return result;
}

function httpUrl(value: unknown, path: string): string {
  const result = string(value, path);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    return fail(path, 'must be an absolute HTTP(S) URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    fail(path, 'must be an absolute HTTP(S) URL without credentials or fragment');
  }
  return result;
}

export function parseValues(input: unknown): Ui4aHelmValues {
  const root = exactObject(input, 'values', [
    'schemaVersion',
    'namespace',
    'experimental',
    'scheduling',
    'network',
    'hosts',
    'images',
    'imagePullPolicy',
    'serviceAccounts',
    'secrets',
    'storage',
    'backup',
    'istio',
  ]);
  exactLiteral(root.schemaVersion, 1, 'values.schemaVersion');

  const namespace = exactObject(root.namespace, 'values.namespace', [
    'create',
    'name',
    'istioInjection',
  ]);
  exactLiteral(namespace.create, true, 'values.namespace.create');
  exactLiteral(namespace.istioInjection, true, 'values.namespace.istioInjection');
  const namespaceName = name(namespace.name, 'values.namespace.name');

  const experimental = exactObject(root.experimental, 'values.experimental', [
    'highAvailability',
    'replicas',
  ]);
  exactLiteral(experimental.highAvailability, false, 'values.experimental.highAvailability');
  exactLiteral(experimental.replicas, 1, 'values.experimental.replicas');

  const scheduling = exactObject(root.scheduling, 'values.scheduling', ['nodeSelector']);
  const rawNodeSelector = object(scheduling.nodeSelector, 'values.scheduling.nodeSelector');
  const nodeSelector = Object.fromEntries(
    Object.entries(rawNodeSelector).map(([key, value]) => {
      if (key === '' || key.length > 253 || key.includes('\0')) {
        fail(`values.scheduling.nodeSelector.${key}`, 'has an invalid key');
      }
      const parsed = string(value, `values.scheduling.nodeSelector.${key}`);
      if (parsed.length > 63) {
        fail(`values.scheduling.nodeSelector.${key}`, 'value must not exceed 63 characters');
      }
      return [key, parsed];
    }),
  );

  const network = exactObject(root.network, 'values.network', ['hostAliases']);
  if (!Array.isArray(network.hostAliases)) {
    fail('values.network.hostAliases', 'must be an array');
  }
  const hostAliases = network.hostAliases.map((entry, index) => {
    const path = `values.network.hostAliases[${index}]`;
    const alias = exactObject(entry, path, ['ip', 'hostnames']);
    const ip = string(alias.ip, `${path}.ip`);
    if (isIP(ip) === 0) fail(`${path}.ip`, 'must be an IP address');
    if (!Array.isArray(alias.hostnames) || alias.hostnames.length === 0) {
      fail(`${path}.hostnames`, 'must be a non-empty array');
    }
    const hostnames = alias.hostnames.map((host, hostIndex) =>
      dnsName(host, `${path}.hostnames[${hostIndex}]`),
    );
    if (new Set(hostnames).size !== hostnames.length) {
      fail(`${path}.hostnames`, 'must not contain duplicates');
    }
    return { ip, hostnames };
  });
  if (new Set(hostAliases.map(({ ip }) => ip)).size !== hostAliases.length) {
    fail('values.network.hostAliases', 'must not contain duplicate IP entries');
  }

  const hosts = exactObject(root.hosts, 'values.hosts', ['web', 'keycloak']);
  const webHost = dnsName(hosts.web, 'values.hosts.web');
  const keycloakHost = dnsName(hosts.keycloak, 'values.hosts.keycloak');
  if (webHost === keycloakHost) fail('values.hosts', 'web and keycloak hosts must differ');

  const rawImages = exactObject(root.images, 'values.images', imageKeys);
  const images = Object.fromEntries(
    imageKeys.map((key) => [key, digestImage(rawImages[key], `values.images.${key}`)]),
  ) as Record<ImageKey, string>;

  exactLiteral(root.imagePullPolicy, 'IfNotPresent', 'values.imagePullPolicy');
  const rawServiceAccounts = exactObject(
    root.serviceAccounts,
    'values.serviceAccounts',
    serviceAccountKeys,
  );
  const serviceAccounts = Object.fromEntries(
    serviceAccountKeys.map((key) => [
      key,
      name(rawServiceAccounts[key], `values.serviceAccounts.${key}`),
    ]),
  ) as Record<ServiceAccountKey, string>;
  if (new Set(Object.values(serviceAccounts)).size !== serviceAccountKeys.length) {
    fail('values.serviceAccounts', 'names must be unique');
  }

  const secrets = exactObject(root.secrets, 'values.secrets', [
    'existingSecretName',
    'runnerExistingSecretName',
    'runnerSecretsKey',
  ]);
  const existingSecretName = name(secrets.existingSecretName, 'values.secrets.existingSecretName');
  const runnerExistingSecretName = name(
    secrets.runnerExistingSecretName,
    'values.secrets.runnerExistingSecretName',
  );
  const runnerSecretsKey = secretKey(secrets.runnerSecretsKey, 'values.secrets.runnerSecretsKey');

  const rawStorage = object(root.storage, 'values.storage');
  const storageMode = string(rawStorage.mode, 'values.storage.mode');
  let storage: DynamicStorage | StaticStorage;
  if (storageMode === 'dynamic') {
    const dynamic = exactObject(rawStorage, 'values.storage', [
      'mode',
      'storageClassName',
      'sizes',
    ]);
    const sizes = exactObject(dynamic.sizes, 'values.storage.sizes', volumeKeys);
    storage = {
      mode: 'dynamic',
      storageClassName: name(dynamic.storageClassName, 'values.storage.storageClassName'),
      sizes: Object.fromEntries(
        volumeKeys.map((key) => [key, quantity(sizes[key], `values.storage.sizes.${key}`)]),
      ) as Record<VolumeKey, string>,
    };
  } else if (storageMode === 'static') {
    const staticStorage = exactObject(rawStorage, 'values.storage', ['mode', 'volumes']);
    const rawVolumes = exactObject(staticStorage.volumes, 'values.storage.volumes', volumeKeys);
    storage = {
      mode: 'static',
      volumes: Object.fromEntries(
        volumeKeys.map((key) => {
          const volume = exactObject(rawVolumes[key], `values.storage.volumes.${key}`, [
            'volumeName',
            'capacity',
            'hostPath',
            'nodeName',
          ]);
          return [
            key,
            {
              volumeName: name(volume.volumeName, `values.storage.volumes.${key}.volumeName`),
              capacity: quantity(volume.capacity, `values.storage.volumes.${key}.capacity`),
              hostPath: absolutePath(volume.hostPath, `values.storage.volumes.${key}.hostPath`),
              nodeName: dnsName(volume.nodeName, `values.storage.volumes.${key}.nodeName`),
            },
          ];
        }),
      ) as Record<VolumeKey, StaticVolume>,
    };
  } else {
    return fail('values.storage.mode', 'must be dynamic or static');
  }

  const backup = exactObject(root.backup, 'values.backup', ['schedule']);
  const schedule = string(backup.schedule, 'values.backup.schedule');
  if (schedule.split(/\s+/).length !== 5) fail('values.backup.schedule', 'must be a cron schedule');

  const istio = exactObject(root.istio, 'values.istio', [
    'gateway',
    'tlsCredentialName',
    'oidcIssuer',
    'oidcAudience',
    'jwksUri',
  ]);
  const oidcIssuer = httpsUrl(istio.oidcIssuer, 'values.istio.oidcIssuer');
  const issuerUrl = new URL(oidcIssuer);
  if (
    issuerUrl.hostname !== keycloakHost ||
    issuerUrl.pathname !== '/realms/ui4a' ||
    issuerUrl.search !== '' ||
    issuerUrl.hash !== ''
  ) {
    fail('values.istio.oidcIssuer', 'must use the configured keycloak host and ui4a realm');
  }

  return {
    schemaVersion: 1,
    namespace: { create: true, name: namespaceName, istioInjection: true },
    experimental: { highAvailability: false, replicas: 1 },
    scheduling: { nodeSelector },
    network: { hostAliases },
    hosts: { web: webHost, keycloak: keycloakHost },
    images,
    imagePullPolicy: 'IfNotPresent',
    serviceAccounts,
    secrets: { existingSecretName, runnerExistingSecretName, runnerSecretsKey },
    storage,
    backup: { schedule },
    istio: {
      gateway: name(istio.gateway, 'values.istio.gateway'),
      tlsCredentialName: name(istio.tlsCredentialName, 'values.istio.tlsCredentialName'),
      oidcIssuer,
      oidcAudience: name(istio.oidcAudience, 'values.istio.oidcAudience'),
      jwksUri: httpUrl(istio.jwksUri, 'values.istio.jwksUri'),
    },
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
