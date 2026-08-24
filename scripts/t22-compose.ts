import { lstatSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateComposeProductionEnvironment } from './t22-compose-inputs';

const project = 'ui4a';
const composeFile = 'deploy/compose/compose.yaml';
const digestImage = /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[0-9a-f]{64}$/;

const fileEnvironmentKeys = [
  'UI4A_DEPLOYMENT_SETTINGS_FILE',
  'UI4A_DEPLOYMENT_SECRETS_FILE',
  'UI4A_POSTGRES_BOOTSTRAP_PASSWORD_FILE',
  'UI4A_MIGRATION_PASSWORD_FILE',
  'UI4A_RUNTIME_PASSWORD_FILE',
  'UI4A_KEYCLOAK_DATABASE_PASSWORD_FILE',
  'UI4A_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE',
  'UI4A_TEMPORAL_SCHEMA_PASSWORD_FILE',
  'UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE',
  'UI4A_POSTGRES_BACKUP_PASSWORD_FILE',
] as const;

const imageEnvironmentKeys = [
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

type ComposeAction = 'preflight' | 'up' | 'status' | 'down' | 'backup' | 'restore-plan' | 'clean';

export interface ComposeProcessCommand {
  executable: 'docker';
  args: string[];
}

export interface ComposeCommandPlan {
  action: ComposeAction;
  preflight: boolean;
  commands: ComposeProcessCommand[];
  report?: Record<string, unknown>;
}

export type ComposeCommandResult =
  { ok: true; code: string; plan?: Record<string, unknown> } | { ok: false; code: string };

export interface ComposeCommandDependencies {
  run(
    command: ComposeProcessCommand,
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<{ exitCode: number }>;
  validateCanonicalDeployment(
    environment: Readonly<Record<string, string | undefined>>,
    readFile: (path: string) => string,
  ): void;
  readCurrentGitRevision(): Promise<string>;
  readImageRevision(image: string): Promise<string>;
  commitExists(revision: string): Promise<boolean>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
}

function fail(code: string): never {
  throw new TypeError(code);
}

function composeCommand(...args: string[]): ComposeProcessCommand {
  return {
    executable: 'docker',
    args: ['compose', '--project-name', project, '-f', composeFile, ...args],
  };
}

export function planComposeCommand(
  argv: readonly string[],
  _environment: Readonly<Record<string, string | undefined>>,
): ComposeCommandPlan {
  const [action, ...options] = argv;
  if (action === 'preflight' && options.length === 0) {
    return { action, preflight: true, commands: [] };
  }
  if (action === 'up' && options.length === 0) {
    return {
      action,
      preflight: true,
      commands: [composeCommand('run', '--rm', 'pki-init'), composeCommand('up', '-d', '--wait')],
    };
  }
  if (action === 'status' && options.length === 0) {
    return { action, preflight: false, commands: [composeCommand('ps')] };
  }
  if (action === 'down' && options.length === 0) {
    return { action, preflight: false, commands: [composeCommand('down')] };
  }
  if (action === 'backup' && options.length === 0) {
    return {
      action,
      preflight: true,
      commands: [],
      report: {
        contract: 'scripts/t22-backup-contract.ts',
        strategy: 'quiesced-pg-dump',
        requiresVerifiedQuiescenceReceipt: true,
        execution: 'plan-only',
      },
    };
  }
  if (action === 'restore-plan' && options.length === 0) {
    return {
      action,
      preflight: true,
      commands: [],
      report: {
        contract: 'scripts/t22-restore-contract.ts',
        target: 'isolated',
        destructive: false,
        useCleanRestore: false,
        execution: 'plan-only',
      },
    };
  }
  if (action === 'clean') {
    if (options.length === 0) fail('COMPOSE_USAGE_INVALID');
    if (
      options.length !== 2 ||
      options[0] !== '--confirm-destroy-volumes' ||
      options[1] !== project
    ) {
      fail('COMPOSE_CLEAN_CONFIRMATION_REQUIRED');
    }
    return {
      action,
      preflight: false,
      commands: [composeCommand('down', '--volumes')],
    };
  }
  fail('COMPOSE_USAGE_INVALID');
}

function validateRegularFile(path: string): void {
  if (!isAbsolute(path)) fail('COMPOSE_PREFLIGHT_FAILED');
  let facts;
  try {
    facts = lstatSync(path);
  } catch {
    fail('COMPOSE_PREFLIGHT_FAILED');
  }
  if (!facts.isFile() || facts.isSymbolicLink() || facts.size === 0) {
    fail('COMPOSE_PREFLIGHT_FAILED');
  }
}

async function preflight(
  dependencies: ComposeCommandDependencies,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ releaseGitSha: string; operatorGitSha: string; relationship: 'ancestor-or-equal' }> {
  if (
    environment.UI4A_DEPLOYMENT_PROFILE !== 'production' ||
    environment.UI4A_DEPLOYMENT_SETTINGS_JSON !== undefined ||
    environment.UI4A_DEPLOYMENT_SECRETS_JSON !== undefined
  ) {
    fail('COMPOSE_PREFLIGHT_FAILED');
  }
  for (const key of fileEnvironmentKeys) {
    const path = environment[key];
    if (path === undefined || path === '') fail('COMPOSE_PREFLIGHT_FAILED');
    validateRegularFile(path);
  }
  for (const key of imageEnvironmentKeys) {
    const image = environment[key];
    if (image === undefined || !digestImage.test(image)) fail('COMPOSE_PREFLIGHT_FAILED');
  }
  try {
    dependencies.validateCanonicalDeployment(environment, (path) => readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && /^COMPOSE_[A-Z_]+$/.test(error.message)) fail(error.message);
    fail('COMPOSE_PREFLIGHT_FAILED');
  }
  const releaseGitSha = environment.UI4A_RELEASE_GIT_SHA;
  if (releaseGitSha === undefined || !/^[0-9a-f]{40}$/.test(releaseGitSha)) {
    fail('COMPOSE_RELEASE_REVISION_INVALID');
  }
  let operatorGitSha: string;
  try {
    operatorGitSha = (await dependencies.readCurrentGitRevision()).trim();
  } catch {
    fail('COMPOSE_GIT_REVISION_UNAVAILABLE');
  }
  if (!/^[0-9a-f]{40}$/.test(operatorGitSha)) fail('COMPOSE_GIT_REVISION_UNAVAILABLE');
  let releaseExists: boolean;
  let releaseIsAncestor: boolean;
  try {
    releaseExists = await dependencies.commitExists(releaseGitSha);
    releaseIsAncestor =
      releaseExists && (await dependencies.isAncestor(releaseGitSha, operatorGitSha));
  } catch {
    fail('COMPOSE_GIT_REVISION_UNAVAILABLE');
  }
  if (!releaseExists || !releaseIsAncestor) fail('COMPOSE_RELEASE_REVISION_NOT_ANCESTOR');
  for (const key of ['UI4A_WEB_IMAGE', 'UI4A_WORKER_IMAGE', 'UI4A_RUNNER_IMAGE'] as const) {
    let revision: string;
    try {
      revision = (await dependencies.readImageRevision(environment[key]!)).trim();
    } catch {
      fail('COMPOSE_IMAGE_INSPECT_FAILED');
    }
    if (revision !== releaseGitSha) fail('COMPOSE_IMAGE_REVISION_MISMATCH');
  }
  return { releaseGitSha, operatorGitSha, relationship: 'ancestor-or-equal' };
}

const successCode: Record<Exclude<ComposeAction, 'backup' | 'restore-plan'>, string> = {
  preflight: 'COMPOSE_PREFLIGHT_COMPLETED',
  up: 'COMPOSE_UP_COMPLETED',
  status: 'COMPOSE_STATUS_COMPLETED',
  down: 'COMPOSE_DOWN_COMPLETED',
  clean: 'COMPOSE_CLEAN_COMPLETED',
};

const failureCode: Record<Exclude<ComposeAction, 'backup' | 'restore-plan'>, string> = {
  preflight: 'COMPOSE_PREFLIGHT_FAILED',
  up: 'COMPOSE_UP_FAILED',
  status: 'COMPOSE_STATUS_FAILED',
  down: 'COMPOSE_DOWN_FAILED',
  clean: 'COMPOSE_CLEAN_FAILED',
};

export async function executeComposeCommand(
  dependencies: ComposeCommandDependencies,
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ComposeCommandResult> {
  let plan: ComposeCommandPlan;
  let preflightReport:
    | { releaseGitSha: string; operatorGitSha: string; relationship: 'ancestor-or-equal' }
    | undefined;
  try {
    plan = planComposeCommand(argv, environment);
    if (plan.preflight) preflightReport = await preflight(dependencies, environment);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'COMPOSE_COMMAND_FAILED';
    return {
      ok: false,
      code: /^COMPOSE_[A-Z_]+$/.test(code) ? code : 'COMPOSE_COMMAND_FAILED',
    };
  }

  if (plan.action === 'backup') {
    return { ok: true, code: 'COMPOSE_BACKUP_PLAN', plan: plan.report };
  }
  if (plan.action === 'restore-plan') {
    return { ok: true, code: 'COMPOSE_RESTORE_PLAN', plan: plan.report };
  }
  if (plan.action === 'preflight') {
    return { ok: true, code: successCode.preflight, plan: preflightReport };
  }

  for (const [index, command] of plan.commands.entries()) {
    let exitCode: number;
    try {
      ({ exitCode } = await dependencies.run(command, environment));
    } catch {
      exitCode = 1;
    }
    if (exitCode !== 0) {
      if (plan.action === 'up' && index === 0) {
        return { ok: false, code: 'COMPOSE_PKI_INIT_FAILED' };
      }
      return { ok: false, code: failureCode[plan.action] };
    }
  }
  return { ok: true, code: successCode[plan.action] };
}

function readProcessOutput(executable: string, args: string[]): Promise<string> {
  return new Promise((complete, reject) => {
    const child = spawn(executable, args, {
      cwd: resolve(import.meta.dirname, '..'),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    let settled = false;
    const failProcess = () => {
      if (settled) return;
      settled = true;
      reject(new Error('COMPOSE_READ_PROCESS_FAILED'));
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 4096) {
        child.kill();
        failProcess();
      }
    });
    child.once('error', failProcess);
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) complete(output);
      else reject(new Error('COMPOSE_READ_PROCESS_FAILED'));
    });
  });
}

const productionDependencies: ComposeCommandDependencies = {
  async run(command, environment) {
    return new Promise((complete) => {
      const child = spawn(command.executable, command.args, {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...process.env, ...environment },
        shell: false,
        stdio: 'inherit',
      });
      child.once('error', () => complete({ exitCode: 1 }));
      child.once('exit', (code) => complete({ exitCode: code ?? 1 }));
    });
  },
  validateCanonicalDeployment(environment, readFile) {
    void readFile;
    validateComposeProductionEnvironment(environment);
  },
  async readCurrentGitRevision() {
    return readProcessOutput('git', ['rev-parse', 'HEAD']);
  },
  async readImageRevision(image) {
    return readProcessOutput('docker', [
      'image',
      'inspect',
      '--format',
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
      image,
    ]);
  },
  async commitExists(revision) {
    try {
      await readProcessOutput('git', ['cat-file', '-e', `${revision}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  },
  async isAncestor(ancestor, descendant) {
    try {
      await readProcessOutput('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  },
};

async function main(): Promise<void> {
  const result = await executeComposeCommand(
    productionDependencies,
    process.argv.slice(2),
    process.env,
  );
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (directEntry === import.meta.url) {
  void main().catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'COMPOSE_COMMAND_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
