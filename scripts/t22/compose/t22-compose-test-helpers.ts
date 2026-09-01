/**
 * T22 Compose 合同测试共享装配(T36 D2 自 t22-compose-contract.test.ts 提取):
 * 合同/renderer 路径、服务清单常量、类型、requiredSource/requiredJson、
 * 渲染器加载与渲染输入/产物查询助手。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect } from 'vitest';

export const repositoryRoot = resolve(import.meta.dirname, '../../..');
export const contractPath = 'deploy/compose/stack-contract.json';
export const rendererPath = 'deploy/compose/render-stack.ts';

export const coreServices = [
  'postgres',
  'postgres-bootstrap',
  'temporal-schema',
  'temporal',
  'temporal-namespace',
  'temporal-ui',
  'keycloak',
  'config-init',
  'realm-bootstrap',
  'migration',
  'web',
  'worker',
  'runner',
  'host-runner',
  'pki-init',
  'edge',
] as const;

export const longRunningServices = [
  'postgres',
  'temporal',
  'temporal-ui',
  'keycloak',
  'web',
  'worker',
  'runner',
  'host-runner',
  'edge',
] as const;

export const initServices = [
  'postgres-bootstrap',
  'temporal-schema',
  'temporal-namespace',
  'realm-bootstrap',
  'migration',
  'pki-init',
  'config-init',
] as const;

export const volumeNames = [
  'postgres-data',
  'backup-data',
  'realm-data',
  'experiment-ca',
  'runner-workspaces',
  'runner-artifacts',
  'runtime-config',
  'runner-config',
  'host-runner-config',
] as const;

export interface StackContract {
  schemaVersion: 1;
  topology: {
    replicas: 1;
    highAvailability: false;
    keycloak: {
      instances: 1;
      realms: ['ui4a'];
      clients: ['ui4a-web', 'ui4a-agent', 'ui4a-api'];
    };
  };
  references: {
    composeFile: string;
    renderer: string;
    productionConfig: string;
    imageContract: string;
    postgresStateful: string;
    postgresBindings: string;
    postgresBackup: string;
    temporal: string;
    keycloakRealm: string;
    keycloakBootstrap: string;
    operatorInputs: string;
    storyAcceptance: string;
  };
  services: string[];
  volumes: Array<{ name: string; retainOnOrdinaryDown: boolean }>;
  lifecycle: {
    up: string[];
    down: string[];
    clean: { command: string[]; confirmation: string; removesVolumes: true };
    backupHook: { contractRef: string; command: string[]; privateArtifacts: string[] };
    restoreHook: { isolatedTargetRequired: true; command: string[] };
  };
  dualRuntime: {
    fallback: false;
    container: {
      service: 'runner';
      runnerId: 'compose-container-runner';
      tokenRef: 'compose-container-runner-token';
      origin: 'https://ui4a.mothership.internal:8443';
      route: '/deliver';
    };
    host: {
      service: 'host-runner';
      profile: 'host-runner';
      runnerId: 'compose-host-runner';
      tokenRef: 'compose-host-runner-token';
      origin: 'https://ui4a.mothership.internal:9444';
      route: '/deliver';
    };
  };
}

export interface ComposeDependency {
  condition: 'service_healthy' | 'service_completed_successfully';
}

export interface ComposeService {
  image: string;
  pull_policy: 'missing';
  profiles?: string[];
  restart?: 'no' | 'unless-stopped';
  depends_on?: Record<string, ComposeDependency>;
  healthcheck?: { test: string[]; interval: string; timeout: string; retries: number };
  environment?: Record<string, string>;
  secrets?: Array<string | { source: string; target?: string; mode?: number }>;
  configs?: Array<string | { source: string; target?: string; mode?: number }>;
  volumes?: string[];
  ports?: string[];
  user?: string;
  read_only?: boolean;
  tmpfs?: string[];
  command?: string[];
  networks?: Record<string, { aliases?: string[] }>;
}

export interface ComposeStack {
  name: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, Record<string, unknown> | null>;
  configs: Record<string, { file: string }>;
  secrets: Record<string, { file: string }>;
  'x-ui4a-contract': {
    schemaVersion: 1;
    replicas: 1;
    highAvailability: false;
    realmLifecycle: 'import-or-check-and-skip';
  };
}

export interface ComposeRenderInput {
  projectName: 'ui4a';
  settingsFile: string;
  secretsFile: string;
  realmFile: string;
  edge: {
    webPublicOrigin: string;
    keycloakPublicOrigin: string;
    publishedPort: number;
  };
  images: Record<
    | 'postgres'
    | 'temporal'
    | 'temporalAdminTools'
    | 'temporalUi'
    | 'keycloak'
    | 'web'
    | 'worker'
    | 'runner'
    | 'edge',
    string
  >;
}

export interface ComposeRenderer {
  renderComposeStack(input: ComposeRenderInput): ComposeStack;
}

export function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 Compose artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

export function requiredJson<T>(path: string): T {
  return JSON.parse(requiredSource(path)) as T;
}

export async function loadRenderer(): Promise<ComposeRenderer> {
  const absolutePath = resolve(repositoryRoot, rendererPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 Compose renderer: ${rendererPath}`);
  }
  return import(pathToFileURL(absolutePath).href) as Promise<ComposeRenderer>;
}

export const digest = (digit: string): string => `sha256:${digit.repeat(64)}`;

export function renderInput(): ComposeRenderInput {
  return {
    projectName: 'ui4a',
    settingsFile: '/srv/ui4a/config/settings.json',
    secretsFile: '/srv/ui4a/secrets/deployment-secrets.json',
    realmFile: 'deploy/keycloak/realm-import.json',
    edge: {
      webPublicOrigin: 'https://ui4a.mothership.internal:8443',
      keycloakPublicOrigin: 'https://auth.ui4a.mothership.internal:8443',
      publishedPort: 8443,
    },
    images: {
      postgres: `nexus.internal/ui4a/postgres@${digest('1')}`,
      temporal: `nexus.internal/ui4a/temporal@${digest('2')}`,
      temporalAdminTools: `nexus.internal/ui4a/temporal-admin-tools@${digest('3')}`,
      temporalUi: `nexus.internal/ui4a/temporal-ui@${digest('4')}`,
      keycloak: `nexus.internal/ui4a/keycloak@${digest('5')}`,
      web: `nexus.internal/ui4a/web@${digest('6')}`,
      worker: `nexus.internal/ui4a/worker@${digest('7')}`,
      runner: `nexus.internal/ui4a/runner@${digest('8')}`,
      edge: `nexus.internal/ui4a/edge@${digest('9')}`,
    },
  };
}

export async function renderedStack(): Promise<ComposeStack> {
  const renderer = await loadRenderer();
  return renderer.renderComposeStack(renderInput());
}

export const edgeRoutingSource = (): string => requiredSource('deploy/compose/edge-routing.caddy');

export function dependency(
  stack: ComposeStack,
  service: string,
  dependencyName: string,
): string | undefined {
  return stack.services[service]?.depends_on?.[dependencyName]?.condition;
}

export function publishedContainerPorts(service: ComposeService): number[] {
  return (service.ports ?? []).flatMap((binding) => {
    const withoutProtocol = binding.split('/')[0] ?? '';
    const containerPort = Number(withoutProtocol.split(':').at(-1));
    return Number.isSafeInteger(containerPort) ? [containerPort] : [];
  });
}
