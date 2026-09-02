/**
 * 生产部署合同的类型与常量(自 production-deployment-config.ts 按配置域拆分,行为不变)。
 * 平台中立:纯类型与字面值,无任何运行时/平台依赖。
 */
export type ProductionDeploymentMode = 'compose' | 'kubernetes';
export type ProductionAgentSpecialization = 'coding' | 'writing' | 'authoring';
export type AgentCredentialSource = 'token-exchange-sub-azp' | 'device-authorization-sub-azp';

export interface ProductionTemporalPersistenceStore {
  database: string;
  schemaUser: string;
  schemaPasswordRef: string;
  runtimeUser: string;
  runtimePasswordRef: string;
}

export type ProductionTemporalTransport =
  | { mode: 'istio' }
  | {
      mode: 'tls';
      serverName: string;
      caCertificatePath: string;
      clientCertificatePath?: string;
      clientPrivateKeyPath?: string;
    };

export interface ProductionDeploymentSettings {
  schemaVersion: 1;
  releaseStage: 'production';
  deploymentMode: ProductionDeploymentMode;
  service: {
    publicOrigin: string;
    trustedRequestOrigins: string[];
  };
  auth: {
    mode: 'oidc';
    oidc: {
      issuer: string;
      audience: 'ui4a-api';
      clientId: 'ui4a-web';
      clientSecretRef: string;
      sessionSecretRef: string;
      agentClientId: 'ui4a-agent';
      agentClientSecretRef: string;
      agentScopes: string[];
      callbackUrl: string;
      scopes: string[];
    };
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    runtimeUser: string;
    runtimePasswordRef: string;
    migrationUser: string;
    migrationPasswordRef: string;
    backupUser: string;
    backupPasswordRef: string;
    pool: { min: number; max: number; idleTimeoutMs: number };
    connectTimeoutMs: number;
    tls: {
      mode: 'verify-full';
      caCertificatePath: string;
      serverCertificatePath: string;
      serverPrivateKeyPath: string;
    };
  };
  temporal: {
    address: string;
    namespace: string;
    taskQueue: string;
    testTaskQueue: string;
    webIdentity: string;
    workerIdentity: string;
    connectTimeoutMs: number;
    transport: ProductionTemporalTransport;
    persistence: {
      host: string;
      port: number;
      defaultStore: ProductionTemporalPersistenceStore;
      visibilityStore: ProductionTemporalPersistenceStore;
    };
  };
  keycloak: {
    host: string;
    realm: 'ui4a';
    database: string;
    databaseUser: string;
    databasePasswordRef: string;
    bootstrapAdminUser: string;
    bootstrapAdminPasswordRef: string;
    experimentHumanPasswordRef: string;
  };
  tls: {
    ui4aHost: string;
    keycloakHost: string;
    caCertificatePath: string;
    ui4aCertificatePath: string;
    ui4aPrivateKeyPath: string;
    keycloakCertificatePath: string;
    keycloakPrivateKeyPath: string;
  };
  llm: {
    baseUrl: string;
    model: string;
    apiKeyRef: string;
    requestTimeoutMs: number;
  };
  runtime: {
    defaultProfiles: Record<ProductionAgentSpecialization, string>;
    profiles: ProductionRuntimeProfile[];
    repositories: ProductionRepository[];
  };
}

interface ProductionRuntimeProfileBase {
  id: string;
  specialization: ProductionAgentSpecialization;
  workspaceRoot: string;
  timeoutSeconds: number;
  resources: { cpu: string; memory: string };
  networkPolicy: 'restricted';
  credentialRefs: string[];
}

export interface KubernetesProductionRuntimeProfile extends ProductionRuntimeProfileBase {
  backend: 'kubernetes';
  image: string;
}

export interface HostProductionRuntimeProfile extends ProductionRuntimeProfileBase {
  backend: 'host';
  runnerId: string;
  runnerTokenRef: string;
}

export type ProductionRuntimeProfile =
  KubernetesProductionRuntimeProfile | HostProductionRuntimeProfile;

export interface ProductionRepository {
  ref: string;
  root: string;
  allowedPaths: string[];
}

export interface ProductionDeploymentConfig {
  settings: ProductionDeploymentSettings;
  secrets: Readonly<Record<string, string>>;
}

export type ProductionRunnerSelection =
  { backend: 'kubernetes'; profileId: string } | { backend: 'host'; runnerId: string };

export const PRODUCTION_DEPLOYMENT_ENV = {
  profile: 'UI4A_DEPLOYMENT_PROFILE',
  settingsJson: 'UI4A_DEPLOYMENT_SETTINGS_JSON',
  secretsJson: 'UI4A_DEPLOYMENT_SECRETS_JSON',
  settingsFile: 'UI4A_DEPLOYMENT_SETTINGS_FILE',
  secretsFile: 'UI4A_DEPLOYMENT_SECRETS_FILE',
} as const;

export const PRODUCTION_DEPLOYMENT_HELM_VALUES_PATH = {
  settings: 'ui4a.deploymentConfig.settings',
  secrets: 'ui4a.deploymentConfig.secrets',
} as const;

export type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;
export type DeploymentFileReader = (path: string) => string;

export class ProductionDeploymentConfigError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'ProductionDeploymentConfigError';
  }
}
