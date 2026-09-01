import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CliError } from './envelope.js';

export interface CliConfig {
  baseUrl: string;
  issuer?: string;
  clientId: string;
  applications: string[];
  token?: string;
  principal: string;
  policyScope: string;
  sources: {
    baseUrl: 'flag' | 'env' | 'config' | 'default';
    issuer: 'env' | 'config' | 'missing';
    clientId: 'env' | 'config' | 'default';
    applications: 'env' | 'config' | 'default';
    token: 'flag' | 'env' | 'config' | 'keychain' | 'missing';
    principal: 'env' | 'config' | 'local-demo-default';
    policyScope: 'env' | 'config' | 'local-demo-default';
  };
}

export interface ConfigFlags {
  baseUrl?: string;
  token?: string;
  configPath?: string;
}

interface ConfigFile {
  baseUrl?: string;
  issuer?: string;
  clientId?: string;
  applications?: string[];
  token?: string;
  principal?: string;
  policyScope?: string;
}

function defaultConfigPath(env: NodeJS.ProcessEnv): string {
  const root = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(root, 'ui4a', 'config.json');
}

async function readConfig(path: string): Promise<ConfigFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as ConfigFile) : {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw error;
  }
}

function cleanUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('UI4A base URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function cleanIssuer(value: string): string {
  const issuer = cleanUrl(value);
  if (new URL(issuer).protocol !== 'https:') {
    throw new Error('UI4A issuer must use https');
  }
  return issuer;
}

function applicationList(value: unknown): string[] {
  const applications =
    typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : value;
  if (
    !Array.isArray(applications) ||
    applications.some((entry) => typeof entry !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry)) ||
    new Set(applications).size !== applications.length
  ) {
    throw new Error('UI4A applications must be unique identifiers');
  }
  return [...applications];
}

export async function loadConfig(
  flags: ConfigFlags,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliConfig> {
  let file: ConfigFile;
  try {
    file = await readConfig(flags.configPath ?? defaultConfigPath(env));
  } catch (error) {
    throw new CliError(
      'CONFIG',
      `cannot read UI4A config: ${error instanceof Error ? error.message : String(error)}`,
      3,
    );
  }
  const rawBase = flags.baseUrl ?? env.UI4A_BASE_URL ?? file.baseUrl ?? 'http://localhost:3100';
  const rawIssuer = env.UI4A_ISSUER ?? file.issuer;
  const clientId = env.UI4A_CLIENT_ID ?? file.clientId ?? 'ui4a-cli';
  const rawApplications = env.UI4A_APPLICATIONS ?? file.applications ?? [];
  const token = flags.token ?? env.UI4A_TOKEN ?? file.token;
  const principal = env.UI4A_PRINCIPAL ?? file.principal ?? 'local-user';
  const policyScope = env.UI4A_POLICY_SCOPE ?? file.policyScope ?? 'publishing';
  let baseUrl: string;
  let issuer: string | undefined;
  let applications: string[];
  try {
    baseUrl = cleanUrl(rawBase);
    issuer = rawIssuer === undefined || rawIssuer === '' ? undefined : cleanIssuer(rawIssuer);
    if (!/^[a-z][a-z0-9-]*$/.test(clientId)) throw new Error('UI4A client ID is invalid');
    applications = applicationList(rawApplications);
  } catch (error) {
    throw new CliError('CONFIG', error instanceof Error ? error.message : String(error), 3);
  }
  if (token !== undefined && token !== '' && new URL(baseUrl).protocol !== 'https:') {
    throw new CliError('CONFIG', 'Bearer authentication requires an HTTPS UI4A base URL', 3);
  }
  return {
    baseUrl,
    ...(issuer === undefined ? {} : { issuer }),
    clientId,
    applications,
    ...(token === undefined || token === '' ? {} : { token }),
    principal,
    policyScope,
    sources: {
      baseUrl:
        flags.baseUrl !== undefined
          ? 'flag'
          : env.UI4A_BASE_URL !== undefined
            ? 'env'
            : file.baseUrl !== undefined
              ? 'config'
              : 'default',
      issuer:
        env.UI4A_ISSUER !== undefined ? 'env' : file.issuer !== undefined ? 'config' : 'missing',
      clientId:
        env.UI4A_CLIENT_ID !== undefined
          ? 'env'
          : file.clientId !== undefined
            ? 'config'
            : 'default',
      applications:
        env.UI4A_APPLICATIONS !== undefined
          ? 'env'
          : file.applications !== undefined
            ? 'config'
            : 'default',
      token:
        flags.token !== undefined
          ? 'flag'
          : env.UI4A_TOKEN !== undefined
            ? 'env'
            : file.token !== undefined
              ? 'config'
              : 'missing',
      principal:
        env.UI4A_PRINCIPAL !== undefined
          ? 'env'
          : file.principal !== undefined
            ? 'config'
            : 'local-demo-default',
      policyScope:
        env.UI4A_POLICY_SCOPE !== undefined
          ? 'env'
          : file.policyScope !== undefined
            ? 'config'
            : 'local-demo-default',
    },
  };
}
