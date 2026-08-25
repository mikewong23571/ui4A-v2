import {
  volumeKeys,
  type KubernetesObject,
  type Ui4aHelmValues,
  type UnknownRecord,
} from './values';

export function metadata(name: string, namespace?: string, component = name) {
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
export const POSTGRES_17_ALPINE_IDENTITY = Object.freeze({ uid: 70, gid: 70 });
const UI4A_NODE_IDENTITY = Object.freeze({ uid: 1000, gid: 1000 });

export function ui4aNodeSecurityContext() {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    readOnlyRootFilesystem: true,
    runAsUser: UI4A_NODE_IDENTITY.uid,
    runAsGroup: UI4A_NODE_IDENTITY.gid,
  };
}

export function vendorNonRootSecurityContext(
  uid: number,
  gid: number,
  readOnlyRootFilesystem = true,
) {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    readOnlyRootFilesystem,
    runAsUser: uid,
    runAsGroup: gid,
  };
}

export function container(name: string, image: string, options: UnknownRecord = {}): UnknownRecord {
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

export function httpProbe(path: string, port: number) {
  return { httpGet: { path, port }, periodSeconds: 10, timeoutSeconds: 3 };
}

export function tcpProbe(port: number, delay = 5) {
  return { tcpSocket: { port }, initialDelaySeconds: delay, periodSeconds: 10 };
}

export function grpcProbe(port: number, delay = 5) {
  return { grpc: { port }, initialDelaySeconds: delay, periodSeconds: 10 };
}

export function selector(name: string) {
  return { 'app.kubernetes.io/name': name, 'app.kubernetes.io/instance': 'ui4a' };
}

export function externalHostAliases(values: Ui4aHelmValues) {
  return values.network.hostAliases.map(({ ip, hostnames }) => ({
    ip,
    hostnames: [...hostnames],
  }));
}

export function podTemplate(
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

export function deployment(
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

export function job(
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

export function service(
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

export function persistentResources(values: Ui4aHelmValues): KubernetesObject[] {
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
