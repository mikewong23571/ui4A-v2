import { spawn } from 'node:child_process';

import type { ParsedArgs } from './args.js';
import { MacOsKeychainCredentialStore } from './auth-keychain.js';
import {
  deviceLogin,
  refreshAccessCredential,
  revokeStoredCredential,
  type AuthDependencies,
} from './auth-oidc.js';
import type { CliConfig } from './config.js';
import { CliError, success, type SuccessEnvelope } from './envelope.js';

interface BrowserChild {
  on(event: 'error', listener: () => void): void;
  unref(): void;
}

export function openBrowser(
  target: string,
  start: (target: string) => BrowserChild = (url) =>
    spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' }),
): void {
  const child = start(target);
  child.on('error', () => {});
  child.unref();
}

export function defaultAuthDependencies(options?: {
  open?: (target: string) => void;
  writeStderr?: (value: string) => void;
  store?: AuthDependencies['store'];
  fetch?: typeof fetch;
}): AuthDependencies {
  return {
    fetch: options?.fetch ?? fetch,
    store: options?.store ?? new MacOsKeychainCredentialStore(),
    notify: async (notice) => {
      (options?.writeStderr ?? ((value) => process.stderr.write(value)))(
        `Open ${notice.verificationUri} and enter code ${notice.userCode}.\n`,
      );
      const target = notice.verificationUriComplete ?? notice.verificationUri;
      (options?.open ?? openBrowser)(target);
    },
  };
}

export async function runAuthCommand(
  args: ParsedArgs,
  config: CliConfig,
  dependencies: AuthDependencies,
): Promise<SuccessEnvelope | undefined> {
  if (args.words[0] !== 'auth') return undefined;
  const verb = args.words[1];
  if (verb === 'login') {
    const result = await deviceLogin(config, dependencies);
    return success('auth.login', {
      loggedIn: true,
      issuer: config.issuer,
      clientId: config.clientId,
      applications: config.applications,
      credentialStore: 'macOS Keychain',
      ...result,
    });
  }
  if (verb === 'status') {
    if (config.issuer === undefined) {
      return success('auth.status', { configured: false, stored: false });
    }
    const stored = await dependencies.store.read({
      issuer: config.issuer,
      clientId: config.clientId,
    });
    return success('auth.status', {
      configured: true,
      stored: stored !== undefined,
      issuer: config.issuer,
      clientId: config.clientId,
      applications: config.applications,
      credentialStore: 'macOS Keychain',
    });
  }
  if (verb === 'logout') {
    return success('auth.logout', {
      revoked: await revokeStoredCredential(config, dependencies),
      credentialStore: 'macOS Keychain',
    });
  }
  throw new CliError('USAGE', 'auth supports login|status|logout', 2);
}

export async function resolveStoredAccessCredential(
  config: CliConfig,
  dependencies: Pick<AuthDependencies, 'fetch' | 'store'>,
): Promise<CliConfig> {
  if (config.token !== undefined || config.issuer === undefined) return config;
  const token = await refreshAccessCredential(config, dependencies);
  return {
    ...config,
    token,
    sources: { ...config.sources, token: 'keychain' },
  };
}
