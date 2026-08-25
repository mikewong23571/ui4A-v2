/**
 * temporal 段解析(自 production-deployment-config.ts 按配置域拆出,行为不变)。
 * 模块内部使用,不经 barrel 导出。
 */
import {
  absolutePath,
  enumValue,
  exactObject,
  fail,
  hostname,
  identifier,
  integer,
  string,
} from './primitives';
import type {
  ProductionDeploymentSettings,
  ProductionTemporalPersistenceStore,
  ProductionTemporalTransport,
} from './types';

export function parseTemporal(value: unknown): ProductionDeploymentSettings['temporal'] {
  const candidate = exactObject(value, 'settings.temporal', [
    'address',
    'namespace',
    'taskQueue',
    'testTaskQueue',
    'webIdentity',
    'workerIdentity',
    'connectTimeoutMs',
    'transport',
    'persistence',
  ]);
  const address = string(candidate.address, 'settings.temporal.address');
  const match = /^([^:]+):(\d+)$/.exec(address);
  if (match === null) fail('settings.temporal.address', 'must be host:port');
  hostname(match[1], 'settings.temporal.address');
  const port = Number(match[2]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    fail('settings.temporal.address', 'port must be between 1 and 65535');
  }
  const namespace = identifier(candidate.namespace, 'settings.temporal.namespace');
  if (namespace === 'default')
    fail('settings.temporal.namespace', 'default is forbidden in production');
  const taskQueue = identifier(candidate.taskQueue, 'settings.temporal.taskQueue');
  const testTaskQueue = identifier(candidate.testTaskQueue, 'settings.temporal.testTaskQueue');
  if (testTaskQueue === taskQueue) {
    fail('settings.temporal.testTaskQueue', 'must differ from taskQueue');
  }

  const rawTransport = exactObject(candidate.transport, 'settings.temporal.transport', [
    'mode',
    'serverName',
    'caCertificatePath',
    'clientCertificatePath',
    'clientPrivateKeyPath',
  ]);
  const transportMode = enumValue(rawTransport.mode, 'settings.temporal.transport.mode', [
    'istio',
    'tls',
  ] as const);
  let transport: ProductionTemporalTransport;
  if (transportMode === 'istio') {
    for (const field of [
      'serverName',
      'caCertificatePath',
      'clientCertificatePath',
      'clientPrivateKeyPath',
    ] as const) {
      if (rawTransport[field] !== undefined) {
        fail(`settings.temporal.transport.${field}`, 'is forbidden for istio transport');
      }
    }
    transport = { mode: 'istio' };
  } else {
    const clientCertificatePath = rawTransport.clientCertificatePath;
    const clientPrivateKeyPath = rawTransport.clientPrivateKeyPath;
    if ((clientCertificatePath === undefined) !== (clientPrivateKeyPath === undefined)) {
      fail(
        'settings.temporal.transport.clientCertificatePath',
        'client certificate and private key must be configured together',
      );
    }
    transport = {
      mode: 'tls',
      serverName: hostname(rawTransport.serverName, 'settings.temporal.transport.serverName'),
      caCertificatePath: absolutePath(
        rawTransport.caCertificatePath,
        'settings.temporal.transport.caCertificatePath',
      ),
      ...(clientCertificatePath === undefined
        ? {}
        : {
            clientCertificatePath: absolutePath(
              clientCertificatePath,
              'settings.temporal.transport.clientCertificatePath',
            ),
            clientPrivateKeyPath: absolutePath(
              clientPrivateKeyPath,
              'settings.temporal.transport.clientPrivateKeyPath',
            ),
          }),
    };
  }

  const persistence = exactObject(candidate.persistence, 'settings.temporal.persistence', [
    'host',
    'port',
    'defaultStore',
    'visibilityStore',
  ]);
  const parseStore = (value: unknown, path: string): ProductionTemporalPersistenceStore => {
    const store = exactObject(value, path, [
      'database',
      'schemaUser',
      'schemaPasswordRef',
      'runtimeUser',
      'runtimePasswordRef',
    ]);
    const parsed = {
      database: identifier(store.database, `${path}.database`),
      schemaUser: identifier(store.schemaUser, `${path}.schemaUser`),
      schemaPasswordRef: identifier(store.schemaPasswordRef, `${path}.schemaPasswordRef`),
      runtimeUser: identifier(store.runtimeUser, `${path}.runtimeUser`),
      runtimePasswordRef: identifier(store.runtimePasswordRef, `${path}.runtimePasswordRef`),
    };
    if (parsed.schemaUser === parsed.runtimeUser) {
      fail(`${path}.runtimeUser`, 'must differ from schemaUser');
    }
    return parsed;
  };
  const defaultStore = parseStore(
    persistence.defaultStore,
    'settings.temporal.persistence.defaultStore',
  );
  const visibilityStore = parseStore(
    persistence.visibilityStore,
    'settings.temporal.persistence.visibilityStore',
  );
  if (defaultStore.database === visibilityStore.database) {
    fail(
      'settings.temporal.persistence.visibilityStore.database',
      'must differ from defaultStore.database',
    );
  }
  return {
    address,
    namespace,
    taskQueue,
    testTaskQueue,
    webIdentity: identifier(candidate.webIdentity, 'settings.temporal.webIdentity'),
    workerIdentity: identifier(candidate.workerIdentity, 'settings.temporal.workerIdentity'),
    connectTimeoutMs: integer(candidate.connectTimeoutMs, 'settings.temporal.connectTimeoutMs'),
    transport,
    persistence: {
      host: hostname(persistence.host, 'settings.temporal.persistence.host'),
      port: integer(persistence.port, 'settings.temporal.persistence.port'),
      defaultStore,
      visibilityStore,
    },
  };
}
