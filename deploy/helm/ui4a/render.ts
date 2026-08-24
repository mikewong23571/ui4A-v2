import { createHash } from 'node:crypto';
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
] as const;
const serviceAccountKeys = [
  'postgres',
  'temporal',
  'keycloak',
  'web',
  'worker',
  'runner',
  'admin',
  'backup',
] as const;
const volumeKeys = ['postgres', 'runtime', 'backup', 'pki'] as const;

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
  secrets: { existingSecretName: string };
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

type UnknownRecord = Record<string, unknown>;

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

function parseValues(input: unknown): Ui4aHelmValues {
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

  const secrets = exactObject(root.secrets, 'values.secrets', ['existingSecretName']);
  const existingSecretName = name(secrets.existingSecretName, 'values.secrets.existingSecretName');

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
  if (new URL(oidcIssuer).hostname !== keycloakHost) {
    fail('values.istio.oidcIssuer', 'must use the configured keycloak host');
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
    secrets: { existingSecretName },
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function metadata(name: string, namespace?: string, component = name) {
  return {
    name,
    ...(namespace === undefined ? {} : { namespace }),
    labels: {
      'app.kubernetes.io/name': component,
      'app.kubernetes.io/instance': 'ui4a',
      'app.kubernetes.io/part-of': 'ui4a',
      'app.kubernetes.io/managed-by': 'ui4a-helm',
    },
  };
}

const resources = {
  requests: { cpu: '100m', memory: '128Mi' },
  limits: { cpu: '1', memory: '1Gi' },
};

// postgres:17-alpine defines the postgres account as uid=70,gid=70. The root handoff init
// copies the 0600 runtime key to this identity before the image entrypoint drops privileges.
const POSTGRES_17_ALPINE_IDENTITY = Object.freeze({ uid: 70, gid: 70 });
const UI4A_NODE_IDENTITY = Object.freeze({ uid: 1000, gid: 1000 });

function ui4aNodeSecurityContext() {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    readOnlyRootFilesystem: true,
    runAsUser: UI4A_NODE_IDENTITY.uid,
    runAsGroup: UI4A_NODE_IDENTITY.gid,
  };
}

function vendorNonRootSecurityContext(uid: number, gid: number, readOnlyRootFilesystem = true) {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    readOnlyRootFilesystem,
    runAsUser: uid,
    runAsGroup: gid,
  };
}

function container(name: string, image: string, options: UnknownRecord = {}): UnknownRecord {
  return {
    name,
    image,
    imagePullPolicy: 'IfNotPresent',
    resources,
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      readOnlyRootFilesystem: true,
    },
    ...options,
  };
}

function httpProbe(path: string, port: number) {
  return { httpGet: { path, port }, periodSeconds: 10, timeoutSeconds: 3 };
}

function tcpProbe(port: number, delay = 5) {
  return { tcpSocket: { port }, initialDelaySeconds: delay, periodSeconds: 10 };
}

function grpcProbe(port: number, delay = 5) {
  return { grpc: { port }, initialDelaySeconds: delay, periodSeconds: 10 };
}

function selector(name: string) {
  return { 'app.kubernetes.io/name': name, 'app.kubernetes.io/instance': 'ui4a' };
}

function externalHostAliases(values: Ui4aHelmValues) {
  return values.network.hostAliases.map(({ ip, hostnames }) => ({
    ip,
    hostnames: [...hostnames],
  }));
}

function podTemplate(
  name: string,
  serviceAccountName: string,
  nodeSelector: Record<string, string>,
  containers: UnknownRecord[],
  options: UnknownRecord = {},
  annotations?: Record<string, string>,
): UnknownRecord {
  return {
    metadata: { labels: selector(name), ...(annotations ? { annotations } : {}) },
    spec: {
      serviceAccountName,
      automountServiceAccountToken: false,
      nodeSelector,
      securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
      containers,
      ...options,
    },
  };
}

function deployment(
  namespace: string,
  name: string,
  serviceAccount: string,
  nodeSelector: Record<string, string>,
  image: string,
  containerOptions: UnknownRecord,
  podOptions: UnknownRecord = {},
  podAnnotations?: Record<string, string>,
): KubernetesObject {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(name, namespace),
    spec: {
      replicas: 1,
      strategy: { type: 'Recreate' },
      selector: { matchLabels: selector(name) },
      template: podTemplate(
        name,
        serviceAccount,
        nodeSelector,
        [container(name, image, containerOptions)],
        podOptions,
        podAnnotations,
      ),
    },
  };
}

function job(
  namespace: string,
  name: string,
  serviceAccount: string,
  nodeSelector: Record<string, string>,
  image: string,
  command: string[],
  options: UnknownRecord = {},
  podOptions: UnknownRecord = {},
): KubernetesObject {
  const template = podTemplate(
    name,
    serviceAccount,
    nodeSelector,
    [container(name, image, { command, ...options })],
    { restartPolicy: 'Never', ...podOptions },
  );
  template.metadata = {
    labels: selector(name),
    annotations: { 'sidecar.istio.io/inject': 'false' },
  };
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: metadata(name, namespace),
    spec: {
      backoffLimit: 2,
      template,
    },
  };
}

function service(
  namespace: string,
  name: string,
  port: number,
  targetPort = port,
): KubernetesObject {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: metadata(name, namespace),
    spec: { selector: selector(name), ports: [{ name: 'http', port, targetPort }] },
  };
}

function persistentResources(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
  const claims = volumeKeys.map((key) => {
    const size =
      values.storage.mode === 'dynamic'
        ? values.storage.sizes[key]
        : values.storage.volumes[key].capacity;
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: metadata(`${key}-data`, namespace, key),
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: size } },
        storageClassName: values.storage.mode === 'dynamic' ? values.storage.storageClassName : '',
        ...(values.storage.mode === 'static'
          ? { volumeName: values.storage.volumes[key].volumeName }
          : {}),
      },
    } satisfies KubernetesObject;
  });
  if (values.storage.mode === 'dynamic') return claims;
  const volumes = volumeKeys.map((key) => {
    const volume = values.storage.mode === 'static' ? values.storage.volumes[key] : neverValue();
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: metadata(volume.volumeName, undefined, key),
      spec: {
        capacity: { storage: volume.capacity },
        accessModes: ['ReadWriteOnce'],
        persistentVolumeReclaimPolicy: 'Retain',
        storageClassName: '',
        local: { path: volume.hostPath },
        nodeAffinity: {
          required: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  {
                    key: 'kubernetes.io/hostname',
                    operator: 'In',
                    values: [volume.nodeName],
                  },
                ],
              },
            ],
          },
        },
      },
    } satisfies KubernetesObject;
  });
  return [...volumes, ...claims];
}

function neverValue(): never {
  throw new Error('unreachable storage mode');
}

const WAIT_FOR_DEPENDENCY_SCRIPT = `
const fs = require('node:fs');
const net = require('node:net');
const dependency = process.env.UI4A_WAIT_FOR;
const namespace = process.env.UI4A_NAMESPACE;
const services = { postgres: ['postgres', 5432], temporal: ['temporal', 7233], keycloak: ['keycloak', 8080] };
const delay = () => new Promise((resolve) => setTimeout(resolve, 2000));
async function waitService([host, port]) {
  for (;;) {
    const ready = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port }, () => { socket.destroy(); resolve(true); });
      socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
      socket.on('error', () => resolve(false));
    });
    if (ready) return;
    await delay();
  }
}
async function waitJob() {
  process.env.NODE_EXTRA_CA_CERTS = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
  const token = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const url = 'https://kubernetes.default.svc/apis/batch/v1/namespaces/' + namespace + '/jobs/' + dependency;
  for (;;) {
    try {
      const response = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
      if (response.ok) {
        const job = await response.json();
        if (job.status?.conditions?.some((condition) => condition.type === 'Complete' && condition.status === 'True')) return;
        if (job.status?.conditions?.some((condition) => condition.type === 'Failed' && condition.status === 'True')) process.exit(70);
      }
    } catch {}
    await delay();
  }
}
void (services[dependency] ? waitService(services[dependency]) : waitJob());
`.trim();

function dependencyGate(
  values: Ui4aHelmValues,
  dependency: string,
  apiToken = false,
): UnknownRecord {
  return container(`wait-for-${dependency}`, values.images.worker, {
    command: ['node', '-e', WAIT_FOR_DEPENDENCY_SCRIPT],
    env: [
      { name: 'UI4A_WAIT_FOR', value: dependency },
      { name: 'UI4A_NAMESPACE', value: values.namespace.name },
      {
        name: 'NODE_EXTRA_CA_CERTS',
        value: '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
      },
    ],
    ...(apiToken
      ? {
          volumeMounts: [
            {
              name: 'dependency-api-token',
              mountPath: '/var/run/secrets/kubernetes.io/serviceaccount',
              readOnly: true,
            },
          ],
        }
      : {}),
    securityContext: ui4aNodeSecurityContext(),
  });
}

function dependencyApiTokenVolume(): UnknownRecord {
  return {
    name: 'dependency-api-token',
    projected: {
      defaultMode: 0o644,
      sources: [
        { serviceAccountToken: { path: 'token', expirationSeconds: 3600 } },
        {
          configMap: {
            name: 'kube-root-ca.crt',
            items: [{ key: 'ca.crt', path: 'ca.crt' }],
          },
        },
      ],
    },
  };
}

function productionEnvironment(extra: UnknownRecord[] = []): UnknownRecord[] {
  return [
    { name: 'UI4A_DEPLOYMENT_PROFILE', value: 'production' },
    { name: 'UI4A_DEPLOYMENT_SETTINGS_FILE', value: '/run/ui4a/settings.json' },
    {
      name: 'UI4A_DEPLOYMENT_SECRETS_FILE',
      value: '/run/secrets/ui4a-deployment-secrets',
    },
    { name: 'NODE_EXTRA_CA_CERTS', value: '/var/run/ui4a/trust/ca-bundle.crt' },
    ...extra,
  ];
}

const productionVolumeMounts = [
  {
    name: 'deployment-settings',
    mountPath: '/run/ui4a/settings.json',
    subPath: 'settings.json',
    readOnly: true,
  },
  {
    name: 'deployment-secrets',
    mountPath: '/run/secrets/ui4a-deployment-secrets',
    subPath: 'ui4a-deployment-secrets',
    readOnly: true,
  },
  { name: 'pki-data', mountPath: '/var/lib/ui4a/ca', readOnly: true },
  { name: 'combined-trust', mountPath: '/var/run/ui4a/trust', readOnly: true },
] as const;

function productionVolumes(secretName: string): UnknownRecord[] {
  return [
    { name: 'deployment-settings', configMap: { name: 'ui4a-deployment-settings' } },
    {
      name: 'deployment-secrets',
      secret: {
        secretName,
        items: [{ key: 'ui4a-deployment-secrets', path: 'ui4a-deployment-secrets' }],
      },
    },
    { name: 'pki-data', persistentVolumeClaim: { claimName: 'pki-data' } },
    {
      name: 'panel-ca',
      configMap: { name: 'ui4a-panel-ca', items: [{ key: 'ca.crt', path: 'ca.crt' }] },
    },
    { name: 'combined-trust', emptyDir: {} },
  ];
}

const TRUST_INIT_SCRIPT = [
  'set -eu',
  'runtime=/var/lib/ui4a/ca/root-ca.crt',
  'panel=/var/run/ui4a/panel-ca/ca.crt',
  'output=/var/run/ui4a/trust/ca-bundle.crt',
  'openssl x509 -in "$runtime" -noout -checkend 0',
  'openssl verify -CAfile "$runtime" "$runtime"',
  'openssl x509 -in "$panel" -noout -checkend 0',
  'openssl verify -CAfile "$panel" "$panel"',
  'cat /var/lib/ui4a/ca/root-ca.crt /var/run/ui4a/panel-ca/ca.crt > /var/run/ui4a/trust/ca-bundle.crt.tmp',
  'chmod 0444 /var/run/ui4a/trust/ca-bundle.crt.tmp',
  'mv /var/run/ui4a/trust/ca-bundle.crt.tmp /var/run/ui4a/trust/ca-bundle.crt',
].join('; ');

function trustInit(values: Ui4aHelmValues): UnknownRecord {
  return container('trust-init', values.images.runner, {
    command: ['/bin/sh', '-ec', TRUST_INIT_SCRIPT],
    volumeMounts: [
      { name: 'pki-data', mountPath: '/var/lib/ui4a/ca', readOnly: true },
      { name: 'panel-ca', mountPath: '/var/run/ui4a/panel-ca', readOnly: true },
      { name: 'combined-trust', mountPath: '/var/run/ui4a/trust' },
    ],
    securityContext: ui4aNodeSecurityContext(),
  });
}

function stateSecretVolume(secretName: string): UnknownRecord {
  return { name: 'state-secrets', secret: { secretName } };
}

const stateSecretMount = { name: 'state-secrets', mountPath: '/run/secrets', readOnly: true };

function dependencyGates(
  values: Ui4aHelmValues,
  dependencies: readonly string[],
  apiToken = false,
) {
  return dependencies.map((dependency) => dependencyGate(values, dependency, apiToken));
}

function renderResources(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
  const postgresHost = `postgres.${namespace}.svc.cluster.local`;
  const keycloakPublicOrigin = new URL(values.istio.oidcIssuer).origin;
  const secretEnvironment = {
    envFrom: [{ secretRef: { name: values.secrets.existingSecretName } }],
  };
  const statefulSet: KubernetesObject = {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: metadata('postgres', namespace),
    spec: {
      replicas: 1,
      serviceName: 'postgres',
      selector: { matchLabels: selector('postgres') },
      template: podTemplate(
        'postgres',
        values.serviceAccounts.postgres,
        values.scheduling.nodeSelector,
        [
          container('postgres', values.images.postgres, {
            args: [
              '-c',
              'ssl=on',
              '-c',
              'ssl_cert_file=/var/run/ui4a/postgres-tls/server.crt',
              '-c',
              'ssl_key_file=/var/run/ui4a/postgres-tls/server.key',
              '-c',
              'ssl_ca_file=/var/run/ui4a/postgres-tls/root-ca.crt',
            ],
            env: [
              { name: 'POSTGRES_USER', value: 'postgres' },
              { name: 'POSTGRES_DB', value: 'postgres' },
              {
                name: 'POSTGRES_PASSWORD_FILE',
                value: '/run/secrets/postgres-bootstrap-password',
              },
            ],
            ports: [{ name: 'postgres', containerPort: 5432 }],
            volumeMounts: [
              { name: 'postgres-data', mountPath: '/var/lib/postgresql/data' },
              { name: 'backup-data', mountPath: '/backups' },
              { name: 'postgres-run', mountPath: '/run/postgresql' },
              { name: 'tmp', mountPath: '/tmp' },
              {
                name: 'postgres-tls',
                mountPath: '/var/run/ui4a/postgres-tls',
                readOnly: true,
              },
              {
                name: 'postgres-bootstrap-password',
                mountPath: '/run/secrets/postgres-bootstrap-password',
                subPath: 'postgres-bootstrap-password',
                readOnly: true,
              },
            ],
            livenessProbe: { exec: { command: ['pg_isready', '-U', 'postgres'] } },
            readinessProbe: tcpProbe(5432),
            securityContext: {
              allowPrivilegeEscalation: false,
              runAsUser: 0,
              capabilities: {
                drop: ['ALL'],
                add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID'],
              },
              readOnlyRootFilesystem: true,
            },
          }),
        ],
        {
          securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
          initContainers: [
            container('postgres-tls-handoff', values.images.runner, {
              command: [
                '/bin/sh',
                '-ec',
                [
                  'set -eu',
                  'root=/var/lib/ui4a/ca/root-ca.crt',
                  'cert=/var/lib/ui4a/ca/postgres/server.crt',
                  'key=/var/lib/ui4a/ca/postgres/server.key',
                  `openssl x509 -in "$cert" -noout -checkhost ${postgresHost}`,
                  'openssl verify -CAfile "$root" "$cert"',
                  'openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER > /tmp/cert.pub',
                  'openssl pkey -in "$key" -pubout -outform DER > /tmp/key.pub',
                  'cmp /tmp/cert.pub /tmp/key.pub',
                  `install -o ${POSTGRES_17_ALPINE_IDENTITY.uid} -g ${POSTGRES_17_ALPINE_IDENTITY.gid} -m 0644 "$root" /var/run/ui4a/postgres-tls/root-ca.crt`,
                  `install -o ${POSTGRES_17_ALPINE_IDENTITY.uid} -g ${POSTGRES_17_ALPINE_IDENTITY.gid} -m 0644 "$cert" /var/run/ui4a/postgres-tls/server.crt`,
                  `install -o ${POSTGRES_17_ALPINE_IDENTITY.uid} -g ${POSTGRES_17_ALPINE_IDENTITY.gid} -m 0600 "$key" /var/run/ui4a/postgres-tls/server.key`,
                  'chmod 0600 /var/run/ui4a/postgres-tls/server.key',
                  'test "$(stat -c %a /var/run/ui4a/postgres-tls/server.key)" = 600',
                ].join('; '),
              ],
              volumeMounts: [
                { name: 'pki-data', mountPath: '/var/lib/ui4a/ca', readOnly: true },
                { name: 'postgres-tls', mountPath: '/var/run/ui4a/postgres-tls' },
                { name: 'tls-handoff-tmp', mountPath: '/tmp' },
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsUser: 0,
                capabilities: { drop: ['ALL'], add: ['CHOWN', 'DAC_READ_SEARCH', 'FOWNER'] },
                readOnlyRootFilesystem: true,
              },
            }),
          ],
          volumes: [
            { name: 'postgres-data', persistentVolumeClaim: { claimName: 'postgres-data' } },
            { name: 'backup-data', persistentVolumeClaim: { claimName: 'backup-data' } },
            { name: 'pki-data', persistentVolumeClaim: { claimName: 'pki-data' } },
            { name: 'postgres-tls', emptyDir: {} },
            { name: 'tls-handoff-tmp', emptyDir: {} },
            { name: 'postgres-run', emptyDir: {} },
            { name: 'tmp', emptyDir: {} },
            {
              name: 'postgres-bootstrap-password',
              secret: {
                secretName: values.secrets.existingSecretName,
                items: [
                  {
                    key: 'postgres-bootstrap-password',
                    path: 'postgres-bootstrap-password',
                  },
                ],
              },
            },
          ],
        },
      ),
    },
  };

  const deployments = [
    deployment(
      namespace,
      'temporal',
      values.serviceAccounts.temporal,
      values.scheduling.nodeSelector,
      values.images.temporal,
      {
        command: ['/bin/sh', '-ec'],
        args: ['exec temporal-server --root /etc/temporal --config config --env docker start'],
        ports: [{ name: 'grpc', containerPort: 7233 }],
        volumeMounts: [
          {
            name: 'temporal-static-config',
            mountPath: '/etc/temporal/config/docker.yaml',
            subPath: 'docker.yaml',
            readOnly: true,
          },
          {
            name: 'temporal-dynamic-config',
            mountPath: '/etc/temporal/dynamicconfig/docker.yaml',
            subPath: 'docker.yaml',
            readOnly: true,
          },
          {
            name: 'temporal-runtime-password',
            mountPath: '/run/secrets/temporal-runtime-password',
            subPath: 'temporal-runtime-password',
            readOnly: true,
          },
          { name: 'tmp', mountPath: '/tmp' },
        ],
        livenessProbe: grpcProbe(7233, 20),
        readinessProbe: grpcProbe(7233, 5),
        securityContext: vendorNonRootSecurityContext(1000, 1000, false),
      },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['temporal-schema'], true),
        volumes: [
          { name: 'temporal-static-config', configMap: { name: 'ui4a-temporal-static' } },
          { name: 'temporal-dynamic-config', configMap: { name: 'ui4a-temporal-dynamic' } },
          {
            name: 'temporal-runtime-password',
            secret: {
              secretName: values.secrets.existingSecretName,
              items: [{ key: 'temporal-runtime-password', path: 'temporal-runtime-password' }],
            },
          },
          { name: 'tmp', emptyDir: {} },
          dependencyApiTokenVolume(),
        ],
      },
      { 'proxy.istio.io/config': '{"holdApplicationUntilProxyStarts":true}' },
    ),
    deployment(
      namespace,
      'temporal-ui',
      values.serviceAccounts.temporal,
      values.scheduling.nodeSelector,
      values.images.temporalUi,
      {
        env: [{ name: 'TEMPORAL_ADDRESS', value: 'temporal:7233' }],
        ports: [{ name: 'http', containerPort: 8080 }],
        volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
        livenessProbe: httpProbe('/', 8080),
        readinessProbe: tcpProbe(8080),
        securityContext: vendorNonRootSecurityContext(1000, 1000),
      },
      {
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        initContainers: dependencyGates(values, ['temporal']),
        volumes: [{ name: 'tmp', emptyDir: {} }],
      },
    ),
    deployment(
      namespace,
      'keycloak',
      values.serviceAccounts.keycloak,
      values.scheduling.nodeSelector,
      values.images.keycloak,
      {
        env: [
          { name: 'KC_DB', value: 'postgres' },
          { name: 'KC_DB_URL_HOST', value: 'postgres' },
          { name: 'KC_DB_URL_DATABASE', value: 'keycloak' },
          { name: 'KC_DB_USERNAME', value: 'keycloak_runtime' },
          { name: 'KC_HEALTH_ENABLED', value: 'true' },
          { name: 'KC_HTTP_ENABLED', value: 'true' },
          { name: 'KC_PROXY_HEADERS', value: 'xforwarded' },
          { name: 'KC_HOSTNAME', value: keycloakPublicOrigin },
          {
            name: 'KC_DB_PASSWORD',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'keycloak-database-password',
              },
            },
          },
          { name: 'KC_BOOTSTRAP_ADMIN_USERNAME', value: 'ui4a-bootstrap' },
          {
            name: 'KC_BOOTSTRAP_ADMIN_PASSWORD',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'keycloak-bootstrap-admin-password',
              },
            },
          },
        ],
        args: ['start'],
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ['ALL'] },
          readOnlyRootFilesystem: false,
        },
        ports: [{ name: 'http', containerPort: 8080 }],
        volumeMounts: [
          { name: 'tmp', mountPath: '/tmp' },
          { name: 'keycloak-data', mountPath: '/opt/keycloak/data' },
        ],
        startupProbe: {
          httpGet: { path: '/health/started', port: 9000 },
          periodSeconds: 5,
          timeoutSeconds: 3,
          failureThreshold: 60,
        },
        livenessProbe: httpProbe('/health/live', 9000),
        readinessProbe: httpProbe('/health/ready', 9000),
      },
      {
        automountServiceAccountToken: true,
        initContainers: dependencyGates(values, ['postgres-bootstrap', 'pki-init']),
        volumes: [
          { name: 'tmp', emptyDir: {} },
          { name: 'keycloak-data', emptyDir: {} },
        ],
      },
    ),
    deployment(
      namespace,
      'web',
      values.serviceAccounts.web,
      values.scheduling.nodeSelector,
      values.images.web,
      {
        env: productionEnvironment([
          { name: 'UI4A_PUBLIC_BASE_URL', value: 'http://web:3100' },
          {
            name: 'UI4A_CAPABILITY_CALLBACK_TOKEN',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'capability-callback-token',
              },
            },
          },
        ]),
        volumeMounts: [
          ...productionVolumeMounts,
          { name: 'tmp', mountPath: '/tmp' },
          { name: 'next-cache', mountPath: '/app/apps/web/.next/cache' },
        ],
        ports: [{ name: 'http', containerPort: 3100 }],
        livenessProbe: httpProbe('/live', 3100),
        readinessProbe: httpProbe('/ready', 3100),
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values),
          ...dependencyGates(values, [
            'migration',
            'realm-bootstrap',
            'temporal-namespace',
            'pki-init',
          ]),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
          { name: 'next-cache', emptyDir: {} },
        ],
      },
    ),
    deployment(
      namespace,
      'worker',
      values.serviceAccounts.worker,
      values.scheduling.nodeSelector,
      values.images.worker,
      {
        env: productionEnvironment([
          { name: 'UI4A_PUBLIC_BASE_URL', value: 'http://web:3100' },
          { name: 'UI4A_RUNNER_IMAGE', value: values.images.runner },
          {
            name: 'UI4A_KUBERNETES_SETTINGS_CONFIGMAP',
            value: 'ui4a-deployment-settings',
          },
          {
            name: 'UI4A_KUBERNETES_SECRETS_SECRET',
            value: values.secrets.existingSecretName,
          },
          { name: 'UI4A_KUBERNETES_WORKSPACE_CLAIM', value: 'runtime-data' },
          {
            name: 'UI4A_KUBERNETES_RUNNER_SERVICE_ACCOUNT',
            value: values.serviceAccounts.runner,
          },
          {
            name: 'UI4A_CAPABILITY_CALLBACK_TOKEN',
            valueFrom: {
              secretKeyRef: {
                name: values.secrets.existingSecretName,
                key: 'capability-callback-token',
              },
            },
          },
        ]),
        volumeMounts: [
          ...productionVolumeMounts,
          { name: 'tmp', mountPath: '/tmp' },
          { name: 'worker-state', mountPath: '/var/lib/ui4a' },
        ],
        ports: [{ name: 'http', containerPort: 3101 }],
        livenessProbe: httpProbe('/live', 3101),
        readinessProbe: httpProbe('/ready', 3101),
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values),
          ...dependencyGates(values, ['migration', 'realm-bootstrap', 'temporal-namespace']),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
          { name: 'worker-state', emptyDir: {} },
        ],
      },
    ),
  ];

  const jobs = [
    job(
      namespace,
      'postgres-bootstrap',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.postgres,
      [
        '/bin/sh',
        '-ec',
        'export PGPASSWORD="$(cat /run/secrets/postgres-bootstrap-password)"; exec psql -v ON_ERROR_STOP=1 -v ui4a_migration_password="$(cat /run/secrets/ui4a-migration-password)" -v ui4a_runtime_password="$(cat /run/secrets/ui4a-runtime-password)" -v keycloak_runtime_password="$(cat /run/secrets/keycloak-database-password)" -v temporal_schema_password="$(cat /run/secrets/temporal-schema-password)" -v temporal_runtime_password="$(cat /run/secrets/temporal-runtime-password)" -v postgres_backup_password="$(cat /run/secrets/postgres-backup-password)" -f /opt/ui4a/bootstrap-roles.sql',
      ],
      {
        env: [
          { name: 'PGHOST', value: 'postgres' },
          { name: 'PGDATABASE', value: 'postgres' },
          { name: 'PGUSER', value: 'postgres' },
          { name: 'PGPASSWORD_FILE', value: '/run/secrets/postgres-bootstrap-password' },
        ],
        volumeMounts: [
          { name: 'bootstrap-sql', mountPath: '/opt/ui4a', readOnly: true },
          stateSecretMount,
        ],
        securityContext: vendorNonRootSecurityContext(70, 70),
      },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['postgres']),
        volumes: [
          { name: 'bootstrap-sql', configMap: { name: 'ui4a-postgres-bootstrap' } },
          stateSecretVolume(values.secrets.existingSecretName),
        ],
      },
    ),
    job(
      namespace,
      'temporal-schema',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.temporalAdminTools,
      [
        '/bin/sh',
        '-ec',
        'TEMPORAL_SCHEMA_PASSWORD="$(cat /run/secrets/temporal-schema-password)"; temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal setup-schema -v 0.0 && temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned && temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility setup-schema -v 0.0 && exec temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned',
      ],
      {
        volumeMounts: [stateSecretMount],
        securityContext: vendorNonRootSecurityContext(1000, 1000, false),
      },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['postgres-bootstrap'], true),
        volumes: [stateSecretVolume(values.secrets.existingSecretName), dependencyApiTokenVolume()],
      },
    ),
    job(
      namespace,
      'temporal-namespace',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.temporalAdminTools,
      [
        '/bin/sh',
        '-ec',
        'temporal operator namespace describe --namespace ui4a --address temporal:7233 >/dev/null 2>&1 || exec temporal operator namespace create --namespace ui4a --address temporal:7233 --retention 72h',
      ],
      { securityContext: vendorNonRootSecurityContext(1000, 1000) },
      {
        automountServiceAccountToken: false,
        initContainers: dependencyGates(values, ['temporal']),
      },
    ),
    job(
      namespace,
      'pki-init',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.runner,
      ['node', 'dist/main.js', 'pki-init'],
      {
        env: [
          { name: 'UI4A_DEPLOYMENT_PROFILE', value: 'production' },
          { name: 'UI4A_DEPLOYMENT_SETTINGS_FILE', value: '/run/ui4a/settings.json' },
          {
            name: 'UI4A_DEPLOYMENT_SECRETS_FILE',
            value: '/run/secrets/ui4a-deployment-secrets',
          },
          { name: 'UI4A_PKI_ROOT', value: '/var/lib/ui4a/ca' },
          { name: 'UI4A_HOST', value: values.hosts.web },
          { name: 'KEYCLOAK_HOST', value: values.hosts.keycloak },
          { name: 'UI4A_POSTGRES_HOST', value: postgresHost },
        ],
        volumeMounts: [
          ...productionVolumeMounts.filter(({ name }) => name !== 'pki-data'),
          { name: 'pki-data', mountPath: '/var/lib/ui4a/ca' },
          { name: 'tmp', mountPath: '/tmp' },
        ],
      },
      {
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
        ],
      },
    ),
    job(
      namespace,
      'migration',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.worker,
      ['node', 'dist/t22-migrate.js'],
      {
        env: productionEnvironment(),
        volumeMounts: [...productionVolumeMounts, { name: 'tmp', mountPath: '/tmp' }],
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [
          trustInit(values),
          ...dependencyGates(values, ['postgres-bootstrap', 'pki-init']),
        ],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
        ],
      },
    ),
    job(
      namespace,
      'realm-bootstrap',
      values.serviceAccounts.admin,
      values.scheduling.nodeSelector,
      values.images.worker,
      ['node', 'dist/t22-keycloak-realm-bootstrap.js', '--apply'],
      {
        env: productionEnvironment([
          { name: 'UI4A_REALM_IMPORT_FILE', value: '/opt/ui4a/realm-import.json' },
        ]),
        volumeMounts: [
          ...productionVolumeMounts,
          { name: 'tmp', mountPath: '/tmp' },
          {
            name: 'realm-import',
            mountPath: '/opt/ui4a/realm-import.json',
            subPath: 'realm-import.json',
            readOnly: true,
          },
        ],
        securityContext: ui4aNodeSecurityContext(),
      },
      {
        automountServiceAccountToken: true,
        hostAliases: externalHostAliases(values),
        initContainers: [trustInit(values), ...dependencyGates(values, ['keycloak', 'pki-init'])],
        volumes: [
          ...productionVolumes(values.secrets.existingSecretName),
          { name: 'tmp', emptyDir: {} },
          { name: 'realm-import', configMap: { name: 'ui4a-realm-import' } },
        ],
      },
    ),
  ];

  const backup: KubernetesObject = {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: metadata('backup', namespace),
    spec: {
      schedule: values.backup.schedule,
      concurrencyPolicy: 'Forbid',
      suspend: false,
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 2,
          template: podTemplate(
            'backup',
            values.serviceAccounts.backup,
            values.scheduling.nodeSelector,
            [
              container('backup', values.images.postgres, {
                ...secretEnvironment,
                command: ['pg_dump', '--format=custom', '--file=/backups/ui4a.dump', 'ui4a'],
                volumeMounts: [{ name: 'backup-data', mountPath: '/backups' }],
                securityContext: vendorNonRootSecurityContext(70, 70),
              }),
            ],
            {
              restartPolicy: 'Never',
              volumes: [
                { name: 'backup-data', persistentVolumeClaim: { claimName: 'backup-data' } },
              ],
            },
          ),
        },
      },
    },
  };

  return [
    {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        ...metadata(namespace),
        labels: { ...metadata(namespace).labels, 'istio-injection': 'enabled' },
      },
    },
    ...serviceAccountKeys.map((key): KubernetesObject => ({
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: metadata(values.serviceAccounts[key], namespace, key),
      automountServiceAccountToken: false,
    })),
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: metadata('ui4a-runtime-jobs', namespace),
      rules: [
        {
          apiGroups: [''],
          resources: ['configmaps'],
          verbs: ['get', 'create', 'delete'],
        },
        {
          apiGroups: ['batch'],
          resources: ['jobs'],
          verbs: ['get', 'create', 'delete'],
        },
        {
          apiGroups: [''],
          resources: ['pods'],
          verbs: ['list'],
        },
        {
          apiGroups: [''],
          resources: ['pods/log'],
          verbs: ['get'],
        },
      ],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: metadata('ui4a-runtime-jobs', namespace),
      subjects: [
        {
          kind: 'ServiceAccount',
          name: values.serviceAccounts.worker,
          namespace,
        },
      ],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'ui4a-runtime-jobs' },
    },
    ...persistentResources(values),
    statefulSet,
    ...deployments,
    ...jobs,
    backup,
    service(namespace, 'postgres', 5432),
    service(namespace, 'temporal', 7233),
    service(namespace, 'temporal-ui', 8080),
    service(namespace, 'keycloak', 8080),
    service(namespace, 'web', 3100),
    service(namespace, 'worker', 3101),
    {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'Gateway',
      metadata: metadata(values.istio.gateway, namespace),
      spec: {
        selector: { istio: 'ingressgateway' },
        servers: [
          {
            port: { number: 443, name: 'https', protocol: 'HTTPS' },
            tls: { mode: 'SIMPLE', credentialName: values.istio.tlsCredentialName },
            hosts: [values.hosts.web, values.hosts.keycloak],
          },
        ],
      },
    },
    {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'VirtualService',
      metadata: metadata('ui4a-web', namespace),
      spec: {
        hosts: [values.hosts.web],
        gateways: [values.istio.gateway],
        http: [
          {
            match: [{ uri: { prefix: '/api/internal/' } }],
            directResponse: { status: 404 },
          },
          { route: [{ destination: { host: 'web', port: { number: 3100 } } }] },
        ],
      },
    },
    {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'VirtualService',
      metadata: metadata('ui4a-keycloak', namespace),
      spec: {
        hosts: [values.hosts.keycloak],
        gateways: [values.istio.gateway],
        http: [{ route: [{ destination: { host: 'keycloak', port: { number: 8080 } } }] }],
      },
    },
    {
      apiVersion: 'security.istio.io/v1beta1',
      kind: 'RequestAuthentication',
      metadata: metadata('ui4a-web-jwt', namespace),
      spec: {
        selector: { matchLabels: selector('web') },
        jwtRules: [
          {
            issuer: values.istio.oidcIssuer,
            audiences: [values.istio.oidcAudience],
            jwksUri: values.istio.jwksUri,
            forwardOriginalToken: true,
          },
        ],
      },
    },
    {
      apiVersion: 'security.istio.io/v1beta1',
      kind: 'AuthorizationPolicy',
      metadata: metadata('ui4a-web', namespace),
      spec: {
        selector: { matchLabels: selector('web') },
        action: 'ALLOW',
        rules: [
          { to: [{ operation: { notPaths: ['/api/internal/*'] } }] },
          {
            from: [
              {
                source: {
                  principals: [`cluster.local/ns/${namespace}/sa/${values.serviceAccounts.worker}`],
                },
              },
            ],
            to: [{ operation: { paths: ['/api/internal/*'] } }],
          },
        ],
      },
    },
  ];
}

export function renderUi4aChart(input: Ui4aHelmValues): RenderResult {
  const values = parseValues(input);
  const rendered = renderResources(values);
  const resourceRefs = rendered.map(({ apiVersion, kind, metadata: resourceMetadata }) => ({
    apiVersion,
    kind,
    ...(resourceMetadata.namespace === undefined ? {} : { namespace: resourceMetadata.namespace }),
    name: resourceMetadata.name,
  }));
  return {
    resources: rendered,
    evidence: {
      schemaVersion: 1,
      resourceRefs,
      valuesHash: `sha256:${createHash('sha256').update(canonicalJson(values)).digest('hex')}`,
    },
  };
}
