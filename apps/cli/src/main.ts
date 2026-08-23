#!/usr/bin/env node
import { parseArgs } from './args.js';
import { HELP, runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { CliError, failure, redact } from './envelope.js';
import { Ui4aHttpClient } from './http.js';

async function main(): Promise<void> {
  let command = 'unknown';
  let json = false;
  try {
    const args = parseArgs(process.argv.slice(2));
    json = args.json;
    command = args.words.slice(0, 2).join('.') || 'help';
    if (args.help || args.words.length === 0) {
      process.stdout.write(HELP);
      return;
    }
    const config = await loadConfig({
      ...(args.baseUrl === undefined ? {} : { baseUrl: args.baseUrl }),
      ...(args.token === undefined ? {} : { token: args.token }),
      ...(args.configPath === undefined ? {} : { configPath: args.configPath }),
    });
    const result = redact(await runCommand(args, new Ui4aHttpClient(config)));
    process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError('INTERNAL', error instanceof Error ? error.message : String(error), 9);
    const output = redact(failure(command, cliError));
    process.stdout.write(`${JSON.stringify(output, null, json ? 0 : 2)}\n`);
    process.exitCode = cliError.exitCode;
  }
}

void main();
