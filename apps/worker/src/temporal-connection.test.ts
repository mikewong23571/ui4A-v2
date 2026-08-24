import type { NativeConnection, NativeConnectionOptions } from '@temporalio/worker';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectWorkerTemporal } from './temporal-connection';

function connection(close = vi.fn(async () => undefined)): NativeConnection {
  return { close } as unknown as NativeConnection;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bounded Worker Temporal connection', () => {
  it('maps canonical TLS transport and returns a connection before the deadline', async () => {
    const connected = connection();
    const connect = vi.fn(async (options: NativeConnectionOptions) => {
      void options;
      return connected;
    });
    const readFile = vi.fn((path: string) => Buffer.from(`fixture:${path}`));

    await expect(
      connectWorkerTemporal(
        {
          address: 'temporal-frontend.ui4a.svc.cluster.local:7233',
          connectTimeoutMs: 15_000,
          transport: {
            mode: 'tls',
            serverName: 'temporal-frontend.ui4a.svc.cluster.local',
            caCertificatePath: '/run/tls/temporal/ca.crt',
            clientCertificatePath: '/run/tls/temporal/client.crt',
            clientPrivateKeyPath: '/run/tls/temporal/client.key',
          },
        },
        { connect, readFile },
      ),
    ).resolves.toBe(connected);
    expect(connect).toHaveBeenCalledWith({
      address: 'temporal-frontend.ui4a.svc.cluster.local:7233',
      tls: {
        serverNameOverride: 'temporal-frontend.ui4a.svc.cluster.local',
        serverRootCACertificate: Buffer.from('fixture:/run/tls/temporal/ca.crt'),
        clientCertPair: {
          crt: Buffer.from('fixture:/run/tls/temporal/client.crt'),
          key: Buffer.from('fixture:/run/tls/temporal/client.key'),
        },
      },
    });
  });

  it('fails at the deadline and closes a NativeConnection that resolves late', async () => {
    vi.useFakeTimers();
    let resolveConnection: ((value: NativeConnection) => void) | undefined;
    const close = vi.fn(async () => undefined);
    const pendingConnection = new Promise<NativeConnection>((resolve) => {
      resolveConnection = resolve;
    });
    const pending = connectWorkerTemporal(
      {
        address: 'temporal-frontend.ui4a.svc.cluster.local:7233',
        connectTimeoutMs: 25,
        transport: { mode: 'istio' },
      },
      {
        connect: vi.fn(() => pendingConnection),
        readFile: vi.fn(),
      },
    );
    const rejected = expect(pending).rejects.toThrow('temporal_connect_timeout');

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    resolveConnection?.(connection(close));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
