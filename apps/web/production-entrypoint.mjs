import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadCapabilityCallbackToken } from './file-secret.mjs';

const defaultInstrumentationUrl = () =>
  pathToFileURL(resolve(process.cwd(), 'apps/web/.next/server/instrumentation.js')).href;
const defaultServerUrl = () => pathToFileURL(resolve(process.cwd(), 'apps/web/server.js')).href;

/** Resolve Next's ESM or CommonJS instrumentation bundle to its startup register function. */
export function instrumentationRegister(moduleNamespace) {
  const candidates = [
    moduleNamespace?.register,
    moduleNamespace?.default?.register,
    moduleNamespace?.['module.exports']?.register,
  ];
  const register = candidates.find((candidate) => typeof candidate === 'function');
  if (!register) throw new Error('Next instrumentation bundle does not export register()');
  return register;
}

/** Await production preflight before loading the standalone server, so failure cannot bind a port. */
export async function startProductionServer({
  loadCallbackToken = () => loadCapabilityCallbackToken(process.env),
  loadModule = (specifier) => import(specifier),
  instrumentationUrl = defaultInstrumentationUrl(),
  serverUrl = defaultServerUrl(),
} = {}) {
  loadCallbackToken();
  const instrumentation = await loadModule(instrumentationUrl);
  const register = instrumentationRegister(instrumentation);
  await register();
  await loadModule(serverUrl);
}

/** Convert bootstrap rejection into the non-zero process result used by the container entrypoint. */
export async function runProductionEntrypoint({
  start = startProductionServer,
  reportError = (error) => {
    const message = error instanceof Error ? error.message : 'unknown startup error';
    console.error(`UI4A Web production bootstrap failed: ${message}`);
  },
} = {}) {
  try {
    await start();
    return 0;
  } catch (error) {
    reportError(error);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) process.exitCode = await runProductionEntrypoint();
