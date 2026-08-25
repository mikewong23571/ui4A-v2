/**
 * postgres 段解析(自 production-deployment-config.ts 按配置域拆出,行为不变)。
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
} from './primitives';
import type { ProductionDeploymentSettings } from './types';

export function parsePostgres(value: unknown): ProductionDeploymentSettings['postgres'] {
  const candidate = exactObject(value, 'settings.postgres', [
    'host',
    'port',
    'database',
    'runtimeUser',
    'runtimePasswordRef',
    'migrationUser',
    'migrationPasswordRef',
    'backupUser',
    'backupPasswordRef',
    'pool',
    'connectTimeoutMs',
    'tls',
  ]);
  const pool = exactObject(candidate.pool, 'settings.postgres.pool', [
    'min',
    'max',
    'idleTimeoutMs',
  ]);
  const min = integer(pool.min, 'settings.postgres.pool.min', 0);
  const max = integer(pool.max, 'settings.postgres.pool.max');
  if (min > max) fail('settings.postgres.pool', 'min must not exceed max');
  const tls = exactObject(candidate.tls, 'settings.postgres.tls', [
    'mode',
    'caCertificatePath',
    'serverCertificatePath',
    'serverPrivateKeyPath',
  ]);
  return {
    host: hostname(candidate.host, 'settings.postgres.host'),
    port: (() => {
      const port = integer(candidate.port, 'settings.postgres.port');
      if (port > 65_535) fail('settings.postgres.port', 'must not exceed 65535');
      return port;
    })(),
    database: identifier(candidate.database, 'settings.postgres.database'),
    runtimeUser: identifier(candidate.runtimeUser, 'settings.postgres.runtimeUser'),
    runtimePasswordRef: identifier(
      candidate.runtimePasswordRef,
      'settings.postgres.runtimePasswordRef',
    ),
    migrationUser: identifier(candidate.migrationUser, 'settings.postgres.migrationUser'),
    migrationPasswordRef: identifier(
      candidate.migrationPasswordRef,
      'settings.postgres.migrationPasswordRef',
    ),
    backupUser: identifier(candidate.backupUser, 'settings.postgres.backupUser'),
    backupPasswordRef: identifier(
      candidate.backupPasswordRef,
      'settings.postgres.backupPasswordRef',
    ),
    pool: {
      min,
      max,
      idleTimeoutMs: integer(pool.idleTimeoutMs, 'settings.postgres.pool.idleTimeoutMs'),
    },
    connectTimeoutMs: integer(candidate.connectTimeoutMs, 'settings.postgres.connectTimeoutMs'),
    tls: {
      mode: enumValue(tls.mode, 'settings.postgres.tls.mode', ['verify-full'] as const),
      caCertificatePath: absolutePath(
        tls.caCertificatePath,
        'settings.postgres.tls.caCertificatePath',
      ),
      serverCertificatePath: absolutePath(
        tls.serverCertificatePath,
        'settings.postgres.tls.serverCertificatePath',
      ),
      serverPrivateKeyPath: absolutePath(
        tls.serverPrivateKeyPath,
        'settings.postgres.tls.serverPrivateKeyPath',
      ),
    },
  };
}
