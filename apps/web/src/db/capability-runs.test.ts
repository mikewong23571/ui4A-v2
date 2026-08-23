import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityRunCommand } from '@ui4a/engine';

import {
  appendCapabilityRawEvent,
  appendCapabilityRunCommand,
  ensureCapabilityRunTables,
  getCapabilityRun,
  listCapabilityRuns,
  rebuildCapabilityRunProjection,
} from './capability-runs';
import { ensureEventsTable, readLog } from './events';
import { getPool } from './pool';

const pool = getPool(process.env.DATABASE_URL!);
const create: CapabilityRunCommand = {
  kind: 'create',
  eventId: 'event:create',
  commandId: 'command:create',
  runId: 'run-1',
  principal: 'user:mike',
  policyScope: 'development',
  source: { rel: 'software-change:main', action: 'start-implementation', eventId: 'core:1' },
  profileName: 'default',
  task: {
    schemaVersion: 1,
    repositoryRef: 'repo:fixture',
    baseRevision: 'a'.repeat(40),
    goal: 'change code',
    constraints: [],
    acceptanceCriteria: ['tests pass'],
    allowedPaths: ['src'],
    budget: {
      timeoutSeconds: 300,
      maxTurns: 20,
      maxRawEvents: 2_000,
      maxRawBytes: 4 * 1024 * 1024,
      maxRawChunkBytes: 64 * 1024,
    },
    redaction: { secretNames: ['API_KEY'], redactHostPaths: true },
  },
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await pool.query('TRUNCATE capability_run_projection, capability_payloads, events');
});

afterEach(() => vi.unstubAllEnvs());

describe('Capability Run persistence', () => {
  it('persists an isolated domain, idempotent command and rebuildable projection', async () => {
    const first = await appendCapabilityRunCommand(pool, create);
    const retry = await appendCapabilityRunCommand(pool, create);
    expect(retry.aggregate).toEqual(first.aggregate);
    expect(await readLog(pool)).toEqual([]);
    await pool.query('TRUNCATE capability_run_projection');
    expect(
      await listCapabilityRuns(pool, { principal: 'user:mike', policyScope: 'development' }),
    ).toEqual([]);
    await rebuildCapabilityRunProjection(pool);
    expect(
      await listCapabilityRuns(pool, { principal: 'user:mike', policyScope: 'development' }),
    ).toHaveLength(1);
  });

  it('content-addresses redacted raw frames and enforces owner scope', async () => {
    vi.stubEnv('API_KEY', 'secret-value');
    await appendCapabilityRunCommand(pool, create);
    const raw = await appendCapabilityRawEvent(pool, {
      runId: 'run-1',
      principal: 'user:mike',
      policyScope: 'development',
      ordinal: 1,
      cursor: '1',
      payload: {
        command: 'echo $API_KEY',
        api_key: 'secret-value',
        message: 'provider leaked secret-value in output',
        cwd: '/private/tmp/workspace/src',
      },
      workspacePath: '/private/tmp/workspace',
      redaction: create.task.redaction,
    });
    expect(raw.payloadHash).toMatch(/^sha256:/);
    const stored = await pool.query<{ payload: unknown }>(
      'SELECT payload FROM capability_payloads WHERE payload_hash=$1',
      [raw.payloadHash],
    );
    expect(JSON.stringify(stored.rows[0]?.payload)).not.toContain('secret-value');
    expect(JSON.stringify(stored.rows[0]?.payload)).toContain('workspace://');
    await expect(
      getCapabilityRun(pool, 'run-1', 'user:other', 'development'),
    ).resolves.toBeUndefined();
    await expect(getCapabilityRun(pool, 'run-1', 'user:mike', 'other')).resolves.toBeUndefined();
  });

  it('rejects oversized or non-consecutive raw frames without persistence', async () => {
    await appendCapabilityRunCommand(pool, create);
    await expect(
      appendCapabilityRawEvent(pool, {
        runId: 'run-1',
        principal: 'user:mike',
        policyScope: 'development',
        ordinal: 1,
        cursor: '1',
        payload: { value: 'x'.repeat(70 * 1024) },
        redaction: create.task.redaction,
      }),
    ).rejects.toThrow('chunk');
    await expect(
      appendCapabilityRawEvent(pool, {
        runId: 'run-1',
        principal: 'user:mike',
        policyScope: 'development',
        ordinal: 2,
        cursor: '2',
        payload: { value: 'ok' },
        redaction: create.task.redaction,
      }),
    ).rejects.toThrow('ordinal');
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            "SELECT count(*) AS count FROM events WHERE domain='capability' AND kind='capability-raw-chunk-recorded'",
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBe(0);
  });
});
