import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  releaseMetadata,
  runDaemon,
  runnerLivePayload,
  unavailableOneshotMessage,
} from './runtime.js';

export interface RunnerCommandOptions {
  environment?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  daemon?: (environment: NodeJS.ProcessEnv) => Promise<void>;
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
    if (command === 'oneshot') {
      stderr(JSON.stringify({ status: 'unavailable', reason: unavailableOneshotMessage() }));
      return 78;
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
