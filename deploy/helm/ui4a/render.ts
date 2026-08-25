import { createHash } from 'node:crypto';

import { renderIstioResources } from './istio';
import { renderBackupCronJob, renderJobs } from './jobs';
import {
  canonicalJson,
  parseValues,
  serviceAccountKeys,
  type KubernetesObject,
  type RenderResult,
  type Ui4aHelmValues,
} from './values';
import { renderDeployments, renderPostgresStatefulSet } from './workloads';
import { metadata, persistentResources, service } from './workload-helpers';

export type { KubernetesObject, RenderResult, Ui4aHelmValues } from './values';

function renderResources(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
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
    renderPostgresStatefulSet(values),
    ...renderDeployments(values),
    ...renderJobs(values),
    renderBackupCronJob(values),
    service(namespace, 'postgres', 5432),
    service(namespace, 'temporal', 7233),
    service(namespace, 'temporal-ui', 8080),
    service(namespace, 'keycloak', 8080),
    service(namespace, 'web', 3100),
    service(namespace, 'worker', 3101),
    ...renderIstioResources(values),
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
