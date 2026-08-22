import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const envFileOption = args[0]?.startsWith('--env-file=') ? args.shift() : undefined;
const envFile = envFileOption
  ? resolve(repositoryRoot, envFileOption.slice('--env-file='.length))
  : resolve(repositoryRoot, '.env.local');
const [command, ...commandArgs] = args;

if (!command) {
  console.error('Usage: node scripts/with-local-env.mjs [--env-file=PATH] COMMAND [...ARGS]');
  process.exit(2);
}

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const child = spawn(command, commandArgs, {
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Failed to start ${command}: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
