import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  executeKubernetesRecoveryDrill,
  KubernetesRecoveryDrillError,
  planKubernetesRecoveryDrill,
  type KubernetesDrillInput,
} from './t22-k8s-backup-restore-drill';

const observationEnvironmentVariable = 'UI4A_K8S_RECOVERY_OBSERVATION_FILE';
const requestEnvironmentVariable = 'UI4A_K8S_RECOVERY_REQUEST_FILE';
const maximumInputBytes = 1024 * 1024;

export interface RecoveryProcessCommand {
  executable: string;
  args: string[];
}

export interface KubernetesRecoveryCliDependencies {
  readPrivateJson(path: string): unknown;
  run(command: RecoveryProcessCommand): Promise<{ exitCode: number }>;
}

export type KubernetesRecoveryCliResult =
  | {
      ok: true;
      code: 'K8S_RECOVERY_PLAN_READY';
      plan: ReturnType<typeof planKubernetesRecoveryDrill>;
    }
  | {
      ok: true;
      code: 'K8S_RECOVERY_EXECUTED';
      receipt: {
        schemaVersion: 1;
        backupId: string;
        drillId: string;
        mode: 'isolated';
        destructive: false;
        targetNamespace: string;
        commandsExecuted: number;
      };
    }
  | { ok: false; code: string };

function readPrivateJson(path: string): unknown {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('K8S_RECOVERY_INPUT_INVALID');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const facts = fstatSync(descriptor);
    if (
      !facts.isFile() ||
      facts.size === 0 ||
      facts.size > maximumInputBytes ||
      (facts.mode & 0o777) !== 0o600 ||
      (facts.mode & 0o077) !== 0
    ) {
      throw new Error('K8S_RECOVERY_INPUT_INVALID');
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function runProcess(command: RecoveryProcessCommand): Promise<{ exitCode: number }> {
  return new Promise((complete, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: resolve(import.meta.dirname, '..'),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error('K8S_RECOVERY_PROCESS_FAILED'));
    };
    child.once('error', fail);
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      complete({ exitCode: code ?? 1 });
    });
  });
}

const productionDependencies: KubernetesRecoveryCliDependencies = {
  readPrivateJson,
  run: runProcess,
};

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('K8S_RECOVERY_INPUT_INVALID');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error('K8S_RECOVERY_INPUT_INVALID');
  }
  return input;
}

function combineInputs(observationValue: unknown, requestValue: unknown): KubernetesDrillInput {
  const observation = record(observationValue, ['current', 'quiescence']);
  const request = record(requestValue, ['backupId', 'drillId', 'gitSha', 'target']);
  return {
    backupId: request.backupId as string,
    drillId: request.drillId as string,
    gitSha: request.gitSha as string,
    target: request.target as KubernetesDrillInput['target'],
    current: observation.current as KubernetesDrillInput['current'],
    quiescence: observation.quiescence as KubernetesDrillInput['quiescence'],
  };
}

function stableCode(error: unknown): string {
  if (error instanceof KubernetesRecoveryDrillError) return error.code;
  return 'K8S_RECOVERY_INPUT_INVALID';
}

function inputPaths(environment: Readonly<Record<string, string | undefined>>): {
  observationPath: string;
  requestPath: string;
} {
  const observationPath = environment[observationEnvironmentVariable];
  const requestPath = environment[requestEnvironmentVariable];
  if (
    observationPath === undefined ||
    requestPath === undefined ||
    !isAbsolute(observationPath) ||
    !isAbsolute(requestPath) ||
    observationPath.includes('\0') ||
    requestPath.includes('\0') ||
    resolve(observationPath) === resolve(requestPath)
  ) {
    throw new Error('K8S_RECOVERY_INPUT_INVALID');
  }
  return { observationPath, requestPath };
}

/** Plan or execute an isolated recovery drill without exposing input or process failure details. */
export async function executeKubernetesRecoveryCli(
  dependencies: KubernetesRecoveryCliDependencies,
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<KubernetesRecoveryCliResult> {
  if (argv.length !== 1 || (argv[0] !== 'plan' && argv[0] !== 'execute')) {
    return { ok: false, code: 'K8S_RECOVERY_USAGE_INVALID' };
  }
  try {
    const { observationPath, requestPath } = inputPaths(environment);
    const input = combineInputs(
      dependencies.readPrivateJson(observationPath),
      dependencies.readPrivateJson(requestPath),
    );
    const plan = planKubernetesRecoveryDrill(input);
    if (argv[0] === 'plan') {
      return { ok: true, code: 'K8S_RECOVERY_PLAN_READY', plan };
    }
    const executed = await executeKubernetesRecoveryDrill({ run: dependencies.run }, input);
    return {
      ok: true,
      code: 'K8S_RECOVERY_EXECUTED',
      receipt: {
        schemaVersion: 1,
        backupId: executed.plan.backupId,
        drillId: executed.plan.drillId,
        mode: 'isolated',
        destructive: false,
        targetNamespace: executed.plan.target.namespace,
        commandsExecuted: executed.plan.commands.length,
      },
    };
  } catch (error) {
    return { ok: false, code: stableCode(error) };
  }
}

async function main(): Promise<void> {
  const result = await executeKubernetesRecoveryCli(
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
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'K8S_RECOVERY_COMMAND_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
