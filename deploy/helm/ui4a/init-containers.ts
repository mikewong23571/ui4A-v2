import type { Ui4aHelmValues, UnknownRecord } from './values';
import { container, ui4aNodeSecurityContext } from './workload-helpers';

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
  image = values.images.adminWorker,
): UnknownRecord {
  return container(`wait-for-${dependency}`, image, {
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

export function dependencyApiTokenVolume(): UnknownRecord {
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

export function productionEnvironment(extra: UnknownRecord[] = []): UnknownRecord[] {
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

export const productionVolumeMounts = [
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

export function productionVolumes(secretName: string): UnknownRecord[] {
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

export function trustInit(values: Ui4aHelmValues, image = values.images.runner): UnknownRecord {
  return container('trust-init', image, {
    command: ['/bin/sh', '-ec', TRUST_INIT_SCRIPT],
    volumeMounts: [
      { name: 'pki-data', mountPath: '/var/lib/ui4a/ca', readOnly: true },
      { name: 'panel-ca', mountPath: '/var/run/ui4a/panel-ca', readOnly: true },
      { name: 'combined-trust', mountPath: '/var/run/ui4a/trust' },
    ],
    securityContext: ui4aNodeSecurityContext(),
  });
}

export function stateSecretVolume(secretName: string): UnknownRecord {
  return { name: 'state-secrets', secret: { secretName } };
}

export const stateSecretMount = {
  name: 'state-secrets',
  mountPath: '/run/secrets',
  readOnly: true,
};

export function dependencyGates(
  values: Ui4aHelmValues,
  dependencies: readonly string[],
  apiToken = false,
  image = values.images.adminWorker,
) {
  return dependencies.map((dependency) => dependencyGate(values, dependency, apiToken, image));
}
