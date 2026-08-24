import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { preflightProductionDeploymentFromEnvironment } from '../packages/shared/src/production-deployment-config';

export const composeSecretFileEnvironmentKeys = [
  'UI4A_POSTGRES_BOOTSTRAP_PASSWORD_FILE',
  'UI4A_MIGRATION_PASSWORD_FILE',
  'UI4A_RUNTIME_PASSWORD_FILE',
  'UI4A_KEYCLOAK_DATABASE_PASSWORD_FILE',
  'UI4A_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE',
  'UI4A_TEMPORAL_SCHEMA_PASSWORD_FILE',
  'UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE',
  'UI4A_POSTGRES_BACKUP_PASSWORD_FILE',
] as const;

export const composeImageEnvironmentKeys = [
  'UI4A_POSTGRES_IMAGE',
  'UI4A_TEMPORAL_IMAGE',
  'UI4A_TEMPORAL_ADMIN_TOOLS_IMAGE',
  'UI4A_TEMPORAL_UI_IMAGE',
  'UI4A_KEYCLOAK_IMAGE',
  'UI4A_WEB_IMAGE',
  'UI4A_WORKER_IMAGE',
  'UI4A_RUNNER_IMAGE',
  'UI4A_EDGE_IMAGE',
] as const;

type SecretFileEnvironmentKey = (typeof composeSecretFileEnvironmentKeys)[number];
type ImageEnvironmentKey = (typeof composeImageEnvironmentKeys)[number];

export interface ComposeProductionInput {
  ui4aGitSha: string;
  settingsFile: string;
  secretsFile: string;
  secretFiles: Record<SecretFileEnvironmentKey, string>;
  images: Record<ImageEnvironmentKey, string>;
}

interface ComposeCanonicalBindingView {
  settings: {
    deploymentMode?: string;
    postgres: {
      migrationPasswordRef: string;
      runtimePasswordRef: string;
      backupPasswordRef: string;
    };
    temporal: {
      persistence: {
        defaultStore: { schemaPasswordRef: string; runtimePasswordRef: string };
        visibilityStore: { schemaPasswordRef: string; runtimePasswordRef: string };
      };
    };
    keycloak: { databasePasswordRef: string; bootstrapAdminPasswordRef: string };
    runtime: {
      profiles: Array<{
        backend: string;
        runnerId?: string;
        runnerTokenRef?: string;
      }>;
    };
  };
  secrets: Readonly<Record<string, string>>;
}

export interface ComposeInputDependencies {
  inspectFile(path: string): {
    regular: boolean;
    symbolicLink: boolean;
    size: number;
    mode: number;
  };
  readFile(path: string): string;
  loadCanonical(
    environment: Readonly<Record<string, string | undefined>>,
    readFile: (path: string) => string,
  ): ComposeCanonicalBindingView;
}

export interface GeneratedComposeProductionEnvironment {
  environment: Readonly<Record<string, string>>;
  summary: { files: 10; secretFiles: 8; images: 9; bindings: 8 };
}

const digestImage = /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[0-9a-f]{64}$/;

function fail(code: string): never {
  throw new TypeError(code);
}

const productionDependencies: ComposeInputDependencies = {
  inspectFile(path) {
    const facts = lstatSync(path);
    return {
      regular: facts.isFile(),
      symbolicLink: facts.isSymbolicLink(),
      size: facts.size,
      mode: facts.mode & 0o777,
    };
  },
  readFile(path) {
    return readFileSync(path, 'utf8');
  },
  loadCanonical(environment, readFile) {
    const deployment = preflightProductionDeploymentFromEnvironment(environment, readFile);
    if (deployment === undefined) fail('COMPOSE_CANONICAL_INPUT_INVALID');
    return deployment;
  },
};

function validatePrivateFile(path: string, dependencies: ComposeInputDependencies): void {
  if (!isAbsolute(path) || path.includes('\0')) fail('COMPOSE_INPUT_FILE_INVALID');
  try {
    const facts = dependencies.inspectFile(path);
    if (!facts.regular || facts.symbolicLink || facts.size <= 0 || facts.mode !== 0o600) {
      fail('COMPOSE_INPUT_FILE_INVALID');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'COMPOSE_INPUT_FILE_INVALID') throw error;
    fail('COMPOSE_INPUT_FILE_INVALID');
  }
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  code: string,
): string {
  const value = environment[key];
  if (value === undefined || value === '') fail(code);
  return value;
}

function sameMaterial(
  environment: Readonly<Record<string, string | undefined>>,
  key: SecretFileEnvironmentKey,
  refs: readonly string[],
  canonical: ComposeCanonicalBindingView,
  dependencies: ComposeInputDependencies,
): void {
  const path = requiredEnvironmentValue(environment, key, 'COMPOSE_INPUT_FILE_INVALID');
  let material: string;
  try {
    material = dependencies.readFile(path);
  } catch {
    fail('COMPOSE_INPUT_FILE_INVALID');
  }
  if (refs.some((ref) => canonical.secrets[ref] !== material)) {
    fail('COMPOSE_SECRET_FILE_MISMATCH');
  }
}

export function validateComposeProductionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: ComposeInputDependencies = productionDependencies,
): GeneratedComposeProductionEnvironment {
  if (
    environment.UI4A_DEPLOYMENT_PROFILE !== 'production' ||
    environment.UI4A_DEPLOYMENT_SETTINGS_JSON !== undefined ||
    environment.UI4A_DEPLOYMENT_SECRETS_JSON !== undefined
  ) {
    fail('COMPOSE_CANONICAL_INPUT_INVALID');
  }
  const releaseGitSha = requiredEnvironmentValue(
    environment,
    'UI4A_RELEASE_GIT_SHA',
    'COMPOSE_RELEASE_REVISION_INVALID',
  );
  if (!/^[0-9a-f]{40}$/.test(releaseGitSha)) fail('COMPOSE_RELEASE_REVISION_INVALID');
  const settingsFile = requiredEnvironmentValue(
    environment,
    'UI4A_DEPLOYMENT_SETTINGS_FILE',
    'COMPOSE_INPUT_FILE_INVALID',
  );
  const secretsFile = requiredEnvironmentValue(
    environment,
    'UI4A_DEPLOYMENT_SECRETS_FILE',
    'COMPOSE_INPUT_FILE_INVALID',
  );
  const filePaths = [
    settingsFile,
    secretsFile,
    ...composeSecretFileEnvironmentKeys.map((key) =>
      requiredEnvironmentValue(environment, key, 'COMPOSE_INPUT_FILE_INVALID'),
    ),
  ];
  for (const path of filePaths) validatePrivateFile(path, dependencies);
  for (const key of composeImageEnvironmentKeys) {
    const image = requiredEnvironmentValue(environment, key, 'COMPOSE_IMAGE_REFERENCE_INVALID');
    if (!digestImage.test(image)) fail('COMPOSE_IMAGE_REFERENCE_INVALID');
  }

  let canonical: ComposeCanonicalBindingView;
  try {
    canonical = dependencies.loadCanonical(environment, dependencies.readFile);
  } catch (error) {
    if (error instanceof Error && /^COMPOSE_[A-Z_]+$/.test(error.message)) throw error;
    fail('COMPOSE_CANONICAL_INPUT_INVALID');
  }
  if (
    canonical.settings.deploymentMode !== undefined &&
    canonical.settings.deploymentMode !== 'compose'
  ) {
    fail('COMPOSE_CANONICAL_INPUT_INVALID');
  }
  const { settings } = canonical;
  const expectedRunnerTokenRefs = {
    'compose-container-runner': 'compose-container-runner-token',
    'compose-host-runner': 'compose-host-runner-token',
  } as const;
  const hostProfiles = settings.runtime.profiles.filter((profile) => profile.backend === 'host');
  if (
    hostProfiles.some(
      (profile) =>
        profile.runnerId === undefined ||
        !Object.hasOwn(expectedRunnerTokenRefs, profile.runnerId) ||
        profile.runnerTokenRef !==
          expectedRunnerTokenRefs[profile.runnerId as keyof typeof expectedRunnerTokenRefs],
    ) ||
    Object.entries(expectedRunnerTokenRefs).some(
      ([runnerId, tokenRef]) =>
        !hostProfiles.some(
          (profile) => profile.runnerId === runnerId && profile.runnerTokenRef === tokenRef,
        ),
    )
  ) {
    fail('COMPOSE_RUNTIME_BINDING_INVALID');
  }
  const containerToken = canonical.secrets[expectedRunnerTokenRefs['compose-container-runner']];
  const hostToken = canonical.secrets[expectedRunnerTokenRefs['compose-host-runner']];
  if (
    containerToken === undefined ||
    hostToken === undefined ||
    containerToken === '' ||
    hostToken === '' ||
    containerToken === hostToken
  ) {
    fail('COMPOSE_RUNTIME_BINDING_INVALID');
  }
  sameMaterial(
    environment,
    'UI4A_POSTGRES_BOOTSTRAP_PASSWORD_FILE',
    ['postgres-bootstrap-password'],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_MIGRATION_PASSWORD_FILE',
    [settings.postgres.migrationPasswordRef],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_RUNTIME_PASSWORD_FILE',
    [settings.postgres.runtimePasswordRef],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_KEYCLOAK_DATABASE_PASSWORD_FILE',
    [settings.keycloak.databasePasswordRef],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE',
    [settings.keycloak.bootstrapAdminPasswordRef],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_TEMPORAL_SCHEMA_PASSWORD_FILE',
    [
      settings.temporal.persistence.defaultStore.schemaPasswordRef,
      settings.temporal.persistence.visibilityStore.schemaPasswordRef,
    ],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE',
    [
      settings.temporal.persistence.defaultStore.runtimePasswordRef,
      settings.temporal.persistence.visibilityStore.runtimePasswordRef,
    ],
    canonical,
    dependencies,
  );
  sameMaterial(
    environment,
    'UI4A_POSTGRES_BACKUP_PASSWORD_FILE',
    [settings.postgres.backupPasswordRef],
    canonical,
    dependencies,
  );

  const safeEnvironment = Object.fromEntries(
    [
      'UI4A_DEPLOYMENT_PROFILE',
      'UI4A_RELEASE_GIT_SHA',
      'UI4A_DEPLOYMENT_SETTINGS_FILE',
      'UI4A_DEPLOYMENT_SECRETS_FILE',
      ...composeSecretFileEnvironmentKeys,
      ...composeImageEnvironmentKeys,
    ].map((key) => [key, environment[key]!]),
  );
  return {
    environment: Object.freeze(safeEnvironment),
    summary: { files: 10, secretFiles: 8, images: 9, bindings: 8 },
  };
}

export function generateComposeProductionEnvironment(
  input: ComposeProductionInput,
  dependencies: ComposeInputDependencies = productionDependencies,
): GeneratedComposeProductionEnvironment {
  return validateComposeProductionEnvironment(
    {
      UI4A_DEPLOYMENT_PROFILE: 'production',
      UI4A_RELEASE_GIT_SHA: input.ui4aGitSha,
      UI4A_DEPLOYMENT_SETTINGS_FILE: input.settingsFile,
      UI4A_DEPLOYMENT_SECRETS_FILE: input.secretsFile,
      ...input.secretFiles,
      ...input.images,
    },
    dependencies,
  );
}

async function main(): Promise<void> {
  const [action, flag, manifestPath] = process.argv.slice(2);
  if (action !== 'generate' || flag !== '--manifest' || manifestPath === undefined) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'COMPOSE_INPUT_USAGE_INVALID' })}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    validatePrivateFile(manifestPath, productionDependencies);
    const input = JSON.parse(readFileSync(manifestPath, 'utf8')) as ComposeProductionInput;
    const generated = generateComposeProductionEnvironment(input);
    process.stdout.write(`${JSON.stringify({ ok: true, ...generated })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'COMPOSE_INPUT_INVALID' })}\n`);
    process.exitCode = 1;
  }
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (directEntry === import.meta.url) void main();
