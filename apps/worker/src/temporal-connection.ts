import { readFileSync } from 'node:fs';

import { NativeConnection, type NativeConnectionOptions } from '@temporalio/worker';

import type { ProductionTemporalTransport } from '@ui4a/shared';

export interface WorkerTemporalConnectionOptions {
  address: string;
  connectTimeoutMs: number;
  transport: ProductionTemporalTransport;
}

interface TemporalConnectionDependencies {
  connect(options: NativeConnectionOptions): Promise<NativeConnection>;
  readFile(path: string): Buffer;
}

const defaultDependencies: TemporalConnectionDependencies = {
  connect: (options) => NativeConnection.connect(options),
  readFile: (path) => readFileSync(path),
};

function nativeConnectionOptions(
  options: WorkerTemporalConnectionOptions,
  readFile: (path: string) => Buffer,
): NativeConnectionOptions {
  if (options.transport.mode === 'istio') return { address: options.address };
  const hasClientCertificate = options.transport.clientCertificatePath !== undefined;
  return {
    address: options.address,
    tls: {
      serverNameOverride: options.transport.serverName,
      serverRootCACertificate: readFile(options.transport.caCertificatePath),
      ...(hasClientCertificate
        ? {
            clientCertPair: {
              crt: readFile(options.transport.clientCertificatePath!),
              key: readFile(options.transport.clientPrivateKeyPath!),
            },
          }
        : {}),
    },
  };
}

/**
 * NativeConnection has no connect-timeout option, so startup owns a strict deadline. A connection
 * that resolves after that deadline is immediately closed and can never reach Worker.create.
 */
export async function connectWorkerTemporal(
  options: WorkerTemporalConnectionOptions,
  dependencies: TemporalConnectionDependencies = defaultDependencies,
): Promise<NativeConnection> {
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  const connection = dependencies.connect(nativeConnectionOptions(options, dependencies.readFile));
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error('temporal_connect_timeout'));
    }, options.connectTimeoutMs);
  });

  void connection
    .then(async (lateConnection) => {
      if (timedOut) await lateConnection.close();
    })
    .catch(() => undefined);

  try {
    return await Promise.race([connection, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
