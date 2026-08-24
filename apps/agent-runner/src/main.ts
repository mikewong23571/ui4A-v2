import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { releaseMetadata, runDaemon, runnerLivePayload } from './runtime.js';
import {
  executeRunnerDelivery,
  type RunnerDeliveryProcessor,
  type RunnerDeliveryResult,
} from './process.js';
import { initializeRunnerPki, type RunnerPkiResult } from './pki.js';

export interface RunnerOneshotAdapter {
  processor: RunnerDeliveryProcessor;
  readDelivery(environment: NodeJS.ProcessEnv): unknown | Promise<unknown>;
  signal?: AbortSignal;
}

export interface RunnerCommandOptions {
  environment?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  daemon?: (environment: NodeJS.ProcessEnv) => Promise<void>;
  oneshot?: RunnerOneshotAdapter;
  pkiInit?: (input: {
    rootDirectory: string;
    ui4aHost: string;
    keycloakHost: string;
  }) => Promise<RunnerPkiResult>;
}

export async function runRunnerCommand(
  command: string,
  options: RunnerCommandOptions = {},
): Promise<number> {
  const environment = options.environment ?? process.env;
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  const stderr = options.stderr ?? ((line: string) => console.error(line));
  const daemon = options.daemon ?? runDaemon;

  try {
    if (command === '--version' || command === 'version') {
      stdout(JSON.stringify(releaseMetadata(environment)));
      return 0;
    }
    if (command === 'health') {
      stdout(JSON.stringify(runnerLivePayload(environment)));
      return 0;
    }
    if (command === 'pki-init') {
      const pkiInit = options.pkiInit ?? initializeRunnerPki;
      try {
        const result = await pkiInit({
          rootDirectory: environment.UI4A_PKI_ROOT ?? '/var/lib/ui4a/ca',
          ui4aHost: environment.UI4A_HOST ?? 'ui4a.mothership.internal',
          keycloakHost: environment.KEYCLOAK_HOST ?? 'auth.ui4a.mothership.internal',
        });
        stdout(JSON.stringify(result));
        return 0;
      } catch (error) {
        const reasonCode =
          error instanceof Error && /^PKI_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'PKI_INIT_FAILED';
        stderr(JSON.stringify({ status: 'failed', reasonCode }));
        return 73;
      }
    }
    if (command === 'oneshot') {
      if (options.oneshot === undefined) {
        stderr(
          JSON.stringify({
            status: 'unavailable',
            reasonCode: 'runner_delivery_not_configured',
          }),
        );
        return 78;
      }
      try {
        const delivery = await options.oneshot.readDelivery(environment);
        const result: RunnerDeliveryResult = await executeRunnerDelivery(
          options.oneshot.processor,
          delivery,
          options.oneshot.signal === undefined ? undefined : { signal: options.oneshot.signal },
        );
        stdout(JSON.stringify(result));
        return 0;
      } catch (error) {
        const reasonCode =
          error instanceof Error && /^runner_[a-z_]+$/.test(error.message)
            ? error.message
            : 'runner_execution_failed';
        stderr(JSON.stringify({ status: 'failed', reasonCode }));
        if (reasonCode === 'runner_execution_timeout') return 124;
        if (reasonCode === 'runner_execution_cancelled') return 130;
        return 75;
      }
    }
    if (command === 'daemon') {
      await daemon(environment);
      return 0;
    }
    throw new Error(`unknown runner command: ${command}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(JSON.stringify({ status: 'failed', reason: message }));
    return 1;
  }
}

export async function runRunnerMain(
  argv: readonly string[] = process.argv.slice(2),
  options: RunnerCommandOptions = {},
): Promise<number> {
  return runRunnerCommand(argv[0] ?? 'daemon', options);
}

function isDirectInvocation(moduleUrl: string, executablePath: string | undefined): boolean {
  return executablePath !== undefined && pathToFileURL(resolve(executablePath)).href === moduleUrl;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  void runRunnerMain().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
