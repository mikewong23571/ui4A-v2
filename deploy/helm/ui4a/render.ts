import { createHash } from 'node:crypto';

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

function parseValues(input: unknown): Ui4aHelmValues {
  const root = exactObject(input, 'values', [
    'schemaVersion',
    'namespace',
    'experimental',
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
  ]);
  const oidcIssuer = httpsUrl(istio.oidcIssuer, 'values.istio.oidcIssuer');
  if (new URL(oidcIssuer).hostname !== keycloakHost) {
    fail('values.istio.oidcIssuer', 'must use the configured keycloak host');
  }

  return {
    schemaVersion: 1,
    namespace: { create: true, name: namespaceName, istioInjection: true },
    experimental: { highAvailability: false, replicas: 1 },
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

function selector(name: string) {
  return { 'app.kubernetes.io/name': name, 'app.kubernetes.io/instance': 'ui4a' };
}

function podTemplate(
  name: string,
  serviceAccountName: string,
  containers: UnknownRecord[],
  options: UnknownRecord = {},
) {
  return {
    metadata: { labels: selector(name) },
    spec: {
      serviceAccountName,
      automountServiceAccountToken: false,
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
  image: string,
  containerOptions: UnknownRecord,
  podOptions: UnknownRecord = {},
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
        [container(name, image, containerOptions)],
        podOptions,
      ),
    },
  };
}

function job(
  namespace: string,
  name: string,
  serviceAccount: string,
  image: string,
  command: string[],
  options: UnknownRecord = {},
  podOptions: UnknownRecord = {},
): KubernetesObject {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: metadata(name, namespace),
    spec: {
      backoffLimit: 2,
      ttlSecondsAfterFinished: 86_400,
      template: podTemplate(
        name,
        serviceAccount,
        [container(name, image, { command, ...options })],
        { restartPolicy: 'Never', ...podOptions },
      ),
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

function renderResources(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
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
        [
          container('postgres', values.images.postgres, {
            ...secretEnvironment,
            ports: [{ name: 'postgres', containerPort: 5432 }],
            volumeMounts: [{ name: 'postgres-data', mountPath: '/var/lib/postgresql/data' }],
            livenessProbe: { exec: { command: ['pg_isready', '-U', 'postgres'] } },
            readinessProbe: tcpProbe(5432),
          }),
        ],
        {
          volumes: [
            { name: 'postgres-data', persistentVolumeClaim: { claimName: 'postgres-data' } },
          ],
        },
      ),
    },
  };

  const deployments = [
    deployment(namespace, 'temporal', values.serviceAccounts.temporal, values.images.temporal, {
      ...secretEnvironment,
      args: ['start'],
      ports: [{ name: 'grpc', containerPort: 7233 }],
      livenessProbe: tcpProbe(7233, 20),
      readinessProbe: { exec: { command: ['temporal', 'operator', 'cluster', 'health'] } },
    }),
    deployment(
      namespace,
      'temporal-ui',
      values.serviceAccounts.temporal,
      values.images.temporalUi,
      {
        ports: [{ name: 'http', containerPort: 8080 }],
        livenessProbe: httpProbe('/', 8080),
        readinessProbe: tcpProbe(8080),
      },
    ),
    deployment(namespace, 'keycloak', values.serviceAccounts.keycloak, values.images.keycloak, {
      ...secretEnvironment,
      args: ['start'],
      ports: [{ name: 'http', containerPort: 8080 }],
      livenessProbe: httpProbe('/health/live', 9000),
      readinessProbe: httpProbe('/health/ready', 9000),
    }),
    deployment(namespace, 'web', values.serviceAccounts.web, values.images.web, {
      ...secretEnvironment,
      ports: [{ name: 'http', containerPort: 3100 }],
      livenessProbe: httpProbe('/live', 3100),
      readinessProbe: httpProbe('/ready', 3100),
    }),
    deployment(
      namespace,
      'worker',
      values.serviceAccounts.worker,
      values.images.worker,
      {
        ...secretEnvironment,
        ports: [{ name: 'http', containerPort: 3101 }],
        livenessProbe: httpProbe('/live', 3101),
        readinessProbe: httpProbe('/ready', 3101),
      },
      { automountServiceAccountToken: true },
    ),
    deployment(
      namespace,
      'runner',
      values.serviceAccounts.runner,
      values.images.runner,
      {
        ...secretEnvironment,
        command: ['node', 'dist/main.js', 'daemon'],
        ports: [{ name: 'http', containerPort: 3102 }],
        volumeMounts: [{ name: 'runtime-data', mountPath: '/workspaces' }],
        livenessProbe: httpProbe('/live', 3102),
        readinessProbe: httpProbe('/ready', 3102),
      },
      { volumes: [{ name: 'runtime-data', persistentVolumeClaim: { claimName: 'runtime-data' } }] },
    ),
  ];

  const jobs = [
    job(
      namespace,
      'postgres-bootstrap',
      values.serviceAccounts.admin,
      values.images.postgres,
      ['psql', '-v', 'ON_ERROR_STOP=1', '-f', '/opt/ui4a/bootstrap-roles.sql'],
      {
        ...secretEnvironment,
        volumeMounts: [{ name: 'bootstrap-sql', mountPath: '/opt/ui4a', readOnly: true }],
      },
      { volumes: [{ name: 'bootstrap-sql', configMap: { name: 'ui4a-postgres-bootstrap' } }] },
    ),
    job(
      namespace,
      'temporal-schema',
      values.serviceAccounts.admin,
      values.images.temporalAdminTools,
      ['temporal-sql-tool', 'setup-and-update-schema'],
      secretEnvironment,
    ),
    job(
      namespace,
      'temporal-namespace',
      values.serviceAccounts.admin,
      values.images.temporalAdminTools,
      ['temporal', 'operator', 'namespace', 'create-or-check', 'ui4a'],
    ),
    job(
      namespace,
      'pki-init',
      values.serviceAccounts.admin,
      values.images.runner,
      ['node', 'dist/pki-init.js'],
      { volumeMounts: [{ name: 'pki-data', mountPath: '/var/lib/ui4a/ca' }] },
      { volumes: [{ name: 'pki-data', persistentVolumeClaim: { claimName: 'pki-data' } }] },
    ),
    job(
      namespace,
      'migration',
      values.serviceAccounts.admin,
      values.images.worker,
      ['node', 'dist/t22-migrate.js'],
      secretEnvironment,
    ),
    job(
      namespace,
      'realm-bootstrap',
      values.serviceAccounts.admin,
      values.images.worker,
      ['node', 'dist/t22-keycloak-realm-bootstrap.js', '--apply'],
      {
        ...secretEnvironment,
        env: [{ name: 'UI4A_REALM_IMPORT_FILE', value: '/opt/ui4a/realm-import.json' }],
        volumeMounts: [
          {
            name: 'realm-import',
            mountPath: '/opt/ui4a/realm-import.json',
            subPath: 'realm-import.json',
            readOnly: true,
          },
        ],
      },
      { volumes: [{ name: 'realm-import', configMap: { name: 'ui4a-realm-import' } }] },
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
            [
              container('backup', values.images.postgres, {
                ...secretEnvironment,
                command: ['pg_dump', '--format=custom', '--file=/backups/ui4a.dump', 'ui4a'],
                volumeMounts: [{ name: 'backup-data', mountPath: '/backups' }],
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
          apiGroups: ['batch'],
          resources: ['jobs'],
          verbs: ['create', 'get', 'list', 'watch', 'delete'],
        },
        {
          apiGroups: [''],
          resources: ['pods', 'pods/log'],
          verbs: ['get', 'list', 'watch'],
        },
      ],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: metadata('ui4a-runtime-jobs', namespace),
      subjects: [{ kind: 'ServiceAccount', name: values.serviceAccounts.worker, namespace }],
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
    service(namespace, 'runner', 3102),
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
        http: [{ route: [{ destination: { host: 'web', port: { number: 3100 } } }] }],
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
        jwtRules: [{ issuer: values.istio.oidcIssuer, audiences: [values.istio.oidcAudience] }],
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
          { to: [{ operation: { paths: ['/api/auth/*'] } }] },
          { from: [{ source: { requestPrincipals: ['*'] } }] },
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
