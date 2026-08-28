import { spawn } from 'node:child_process';
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  captureKubernetesRecoveryObservation,
  KubernetesRecoveryObservationError,
  type KubectlObservationCommand,
  type KubernetesRecoveryObservationInput,
} from './t22-k8s-recovery-observe';

const maximumKubectlJsonBytes = 2 * 1024 * 1024;

export interface KubernetesRecoveryObserveCliDependencies {
  capture(input: KubernetesRecoveryObservationInput): Promise<Record<string, unknown>>;
  writePrivateJson(path: string, value: unknown): void;
}

function runKubectl(
  command: KubectlObservationCommand,
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((complete, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('K8S_RECOVERY_OBSERVATION_COMMAND_FAILED'));
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > maximumKubectlJsonBytes) fail();
    });
    child.once('error', fail);
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      complete({ exitCode: code ?? 1, stdout });
    });
  });
}

function writePrivateJson(path: string, value: unknown): void {
  if (!isAbsolute(path) || path.includes('\0') || basename(path) === '') {
    throw new Error('K8S_RECOVERY_OBSERVATION_OUTPUT_INVALID');
  }
  const staging = resolve(dirname(path), `.${basename(path)}.incomplete-${process.pid}`);
  let descriptor: number | undefined;
  let staged = false;
  try {
    descriptor = openSync(
      staging,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    staged = true;
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(staging, path);
    unlinkSync(staging);
    staged = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (staged) {
      try {
        unlinkSync(staging);
      } catch {
        // A stable output error is returned by the caller; partial staging is best-effort removed.
      }
    }
  }
}

const productionDependencies: KubernetesRecoveryObserveCliDependencies = {
  capture: (input) =>
    captureKubernetesRecoveryObservation(
      { run: runKubectl, clock: () => new Date().toISOString() },
      input,
    ),
  writePrivateJson,
};

function inputFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): KubernetesRecoveryObservationInput & { outputPath: string } {
  const namespace = environment.UI4A_K8S_RECOVERY_NAMESPACE;
  const firstHwmProbe = environment.UI4A_K8S_RECOVERY_HWM_PROBE_FIRST;
  const secondHwmProbe = environment.UI4A_K8S_RECOVERY_HWM_PROBE_SECOND;
  const outputPath = environment.UI4A_K8S_RECOVERY_OBSERVATION_OUTPUT_FILE;
  if (
    namespace === undefined ||
    firstHwmProbe === undefined ||
    secondHwmProbe === undefined ||
    outputPath === undefined ||
    !isAbsolute(outputPath) ||
    outputPath.includes('\0')
  ) {
    throw new Error('K8S_RECOVERY_OBSERVATION_INPUT_INVALID');
  }
  return { namespace, firstHwmProbe, secondHwmProbe, outputPath };
}

/** Capture one observed input and create an exact-0600 no-overwrite operator artifact. */
export async function executeKubernetesRecoveryObserveCli(
  dependencies: KubernetesRecoveryObserveCliDependencies,
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<Record<string, unknown>> {
  if (argv.join('\0') !== 'capture') {
    return { ok: false, code: 'K8S_RECOVERY_OBSERVATION_USAGE_INVALID' };
  }
  let input: KubernetesRecoveryObservationInput & { outputPath: string };
  try {
    input = inputFromEnvironment(environment);
  } catch {
    return { ok: false, code: 'K8S_RECOVERY_OBSERVATION_INPUT_INVALID' };
  }
  let observation: Record<string, unknown>;
  try {
    observation = await dependencies.capture(input);
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof KubernetesRecoveryObservationError
          ? error.code
          : 'K8S_RECOVERY_OBSERVATION_FAILED',
    };
  }
  try {
    dependencies.writePrivateJson(input.outputPath, observation);
  } catch {
    return { ok: false, code: 'K8S_RECOVERY_OBSERVATION_WRITE_FAILED' };
  }
  return {
    ok: true,
    code: 'K8S_RECOVERY_OBSERVATION_WRITTEN',
    receipt: {
      namespace: input.namespace,
      outputPath: input.outputPath,
      firstHwmProbe: input.firstHwmProbe,
      secondHwmProbe: input.secondHwmProbe,
    },
  };
}

async function main(): Promise<void> {
  const result = await executeKubernetesRecoveryObserveCli(
    productionDependencies,
    process.argv.slice(2),
    process.env,
  );
  const stream = result.ok === true ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result)}\n`);
  if (result.ok !== true) process.exitCode = 1;
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (directEntry === import.meta.url) {
  void main().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: 'K8S_RECOVERY_OBSERVATION_FAILED' })}\n`,
    );
    process.exitCode = 1;
  });
}
