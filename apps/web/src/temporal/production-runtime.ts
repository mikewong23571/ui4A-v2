import { readFileSync } from 'node:fs';

import { Client, Connection, type ConnectionOptions } from '@temporalio/client';

import type { ProductionTemporalTransport } from '@ui4a/shared';

import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';

export interface WebTemporalRuntime {
  client: Client;
  taskQueue: string;
}

interface OwnedWebTemporalRuntime extends WebTemporalRuntime {
  connection: Connection;
}

function connectionTransport(
  transport: ProductionTemporalTransport,
): Pick<ConnectionOptions, 'tls'> {
  if (transport.mode === 'istio') return {};
  const hasClientCertificate = transport.clientCertificatePath !== undefined;
  return {
    tls: {
      serverNameOverride: transport.serverName,
      serverRootCACertificate: readFileSync(transport.caCertificatePath),
      ...(hasClientCertificate
        ? {
            clientCertPair: {
              crt: readFileSync(transport.clientCertificatePath!),
              key: readFileSync(transport.clientPrivateKeyPath!),
            },
          }
        : {}),
    },
  };
}

async function createTemporalRuntime(): Promise<OwnedWebTemporalRuntime> {
  const production = runWebProductionDeploymentPreflight();
  if (production === undefined) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    });
    return {
      connection,
      client: new Client({
        connection,
        namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
        identity: process.env.UI4A_WEB_IDENTITY ?? 'ui4a-web-local',
      }),
      taskQueue: process.env.UI4A_TASK_QUEUE ?? 'ui4a',
    };
  }

  const temporal = production.settings.temporal;
  const connection = await Connection.connect({
    address: temporal.address,
    connectTimeout: temporal.connectTimeoutMs,
    ...connectionTransport(temporal.transport),
  });
  return {
    connection,
    client: new Client({
      connection,
      namespace: temporal.namespace,
      identity: temporal.webIdentity,
    }),
    taskQueue: temporal.taskQueue,
  };
}

let runtimePromise: Promise<OwnedWebTemporalRuntime> | null = null;

/** One process-owned Temporal connection and Client shared by all Web workflow consumers. */
export function getWebTemporalRuntime(): Promise<WebTemporalRuntime> {
  if (runtimePromise === null) {
    const pending = createTemporalRuntime();
    runtimePromise = pending;
    pending.catch(() => {
      if (runtimePromise === pending) runtimePromise = null;
    });
  }
  return runtimePromise;
}

/** Test/process teardown hook. Repeated consumer resets close the shared connection once. */
export function resetWebTemporalRuntimeForTests(): void {
  const pending = runtimePromise;
  if (pending === null) return;
  runtimePromise = null;
  void pending
    .then(async ({ connection }) => {
      if (typeof connection.close === 'function') await connection.close();
    })
    .catch(() => undefined);
}
