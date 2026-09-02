export const composeImageKeys = [
  'postgres',
  'temporal',
  'temporalAdminTools',
  'temporalUi',
  'keycloak',
  'web',
  'worker',
  'runner',
  'edge',
] as const;

export type ComposeImageKey = (typeof composeImageKeys)[number];

export interface ComposeRenderInput {
  projectName: 'ui4a';
  settingsFile: string;
  secretsFile: string;
  realmFile: string;
  edge: {
    webPublicOrigin: string;
    keycloakPublicOrigin: string;
    trustedRequestOrigins: string[];
    ui4aTlsHost: string;
    keycloakTlsHost: string;
    bindAddress: string;
    publishedPort: number;
  };
  images: Record<ComposeImageKey, string>;
}

export type ComposeDependencyCondition = 'service_healthy' | 'service_completed_successfully';

export interface ComposeService {
  image: string;
  pull_policy: 'missing';
  profiles?: string[];
  restart: 'no' | 'unless-stopped';
  depends_on?: Record<string, { condition: ComposeDependencyCondition }>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
  environment?: Record<string, string>;
  secrets?: Array<{ source: string; target: string; mode: number }>;
  configs?: Array<{ source: string; target: string; mode: number }>;
  volumes?: string[];
  ports?: string[];
  networks?: Record<string, { aliases?: string[] }>;
  network_mode?: string;
  user?: string;
  read_only?: boolean;
  tmpfs?: string[];
  entrypoint?: string[];
  command?: string[];
}

export interface ComposeStack {
  name: 'ui4a';
  services: Record<string, ComposeService>;
  volumes: Record<string, { labels: Record<string, string> }>;
  configs: Record<string, { file: string } | { content: string }>;
  secrets: Record<string, { file: string }>;
  'x-ui4a-contract': {
    schemaVersion: 1;
    replicas: 1;
    highAvailability: false;
    realmLifecycle: 'import-or-check-and-skip';
  };
}
