import { CliError } from './envelope.js';

export interface ParsedArgs {
  json: boolean;
  help: boolean;
  baseUrl?: string;
  token?: string;
  configPath?: string;
  words: string[];
  flags: Record<string, string | boolean>;
}

const GLOBAL_VALUE = new Set(['base-url', 'token', 'config']);
const FORBIDDEN_FLAGS = new Set(['actor', 'principal', 'no-draft', 'approve', 'reject']);

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { json: false, help: false, words: [], flags: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') result.json = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (FORBIDDEN_FLAGS.has(name)) {
        throw new CliError('USAGE', `--${name} is forbidden; identity and policy are server-owned`, 2);
      }
      const next = argv[index + 1];
      if (GLOBAL_VALUE.has(name)) {
        if (next === undefined || next.startsWith('--')) throw new CliError('USAGE', `--${name} requires a value`, 2);
        index += 1;
        if (name === 'base-url') result.baseUrl = next;
        else if (name === 'token') result.token = next;
        else result.configPath = next;
      } else if (next !== undefined && !next.startsWith('--')) {
        result.flags[name] = next;
        index += 1;
      } else {
        result.flags[name] = true;
      }
    } else result.words.push(arg);
  }
  return result;
}

export function flagString(args: ParsedArgs, name: string, required = false): string | undefined {
  const value = args.flags[name];
  if (typeof value === 'string') return value;
  if (required) throw new CliError('USAGE', `--${name} is required`, 2);
  return undefined;
}

export function flagNumber(args: ParsedArgs, name: string, fallback?: number): number | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new CliError('USAGE', `--${name} must be a non-negative integer`, 2);
  return value;
}
