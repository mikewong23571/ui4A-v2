import { describe, expect, it, vi } from 'vitest';

const { dispatchNativeFunction } = vi.hoisted(() => ({
  dispatchNativeFunction: vi.fn(async () => undefined),
}));
vi.mock('../../temporal/native-function', () => ({ dispatchNativeFunction }));

import type { DbExecutor } from '@ui4a/db/events';
import type { NativeFunctionProfileV1 } from '@ui4a/shared';

import { reconcilePersistedNativeFunctions } from './reconciliation';

const hash = `sha256:${'a'.repeat(64)}`;
const profile: NativeFunctionProfileV1 = {
  schemaVersion: 1,
  ref: 'security-enrichment-default',
  version: '1',
  executorClass: 'native-function',
  handlerRef: 'security/cve-enrich@1',
  adapterVersion: 'native-function@1',
  availability: { status: 'available' },
  limits: {
    startToCloseTimeoutMs: 30_000,
    maximumAttempts: 3,
    inputBytes: 16_384,
    outputBytes: 32_768,
  },
  network: 'denied',
};

function db(receipts: string[] = []): DbExecutor {
  return {
    query: vi.fn(async (sql: string) =>
      sql.includes("kind='spawn-requested'")
        ? {
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
            rows: [
              {
                seq: 42,
                rel: 'cve:CVE-2026-0001',
                action: 'enrich-impact',
                actor: 'human',
                principal: 'user:mike',
                channel: 'web',
                detail: {
                  capability: 'cve.enrich',
                  bind: {
                    schemaVersion: 1,
                    fields: { cveId: { from: 'source-field', name: 'cveId' } },
                  },
                  'on-done': 'enrichment-succeeded',
                  'on-error': 'enrichment-failed',
                  nativeFunction: {
                    profile,
                    birth: {
                      capability: { name: 'cve.enrich', hash },
                      profile: {
                        ref: profile.ref,
                        version: profile.version,
                        handlerRef: profile.handlerRef,
                        adapterVersion: profile.adapterVersion,
                        limitsHash: hash,
                      },
                      inputContract: { hash, schema: { type: 'object' } },
                      outputContract: { hash, schema: { type: 'object' } },
                    },
                    callback: {
                      onDoneAction: 'enrichment-succeeded',
                      onErrorAction: 'enrichment-failed',
                    },
                    input: {
                      payload: { cveId: 'CVE-2026-0001' },
                      sources: {
                        cveId: {
                          from: 'source-field',
                          name: 'cveId',
                          rel: 'cve:CVE-2026-0001',
                        },
                      },
                      hash,
                      byteLength: 27,
                    },
                    source: {
                      rel: 'cve:CVE-2026-0001',
                      action: 'enrich-impact',
                      principal: 'user:mike',
                      policyScope: 'security',
                    },
                  },
                },
              },
            ],
          }
        : {
            command: 'SELECT',
            rowCount: receipts.length,
            oid: 0,
            fields: [],
            rows: receipts.map((execution_id) => ({ execution_id })),
          },
    ) as DbExecutor['query'],
  };
}

describe('Native Function spawn outbox reconciliation', () => {
  it('starts one persisted orphan using its birth-pinned profile and deterministic identity', async () => {
    dispatchNativeFunction.mockClear();
    const result = await reconcilePersistedNativeFunctions(db());
    expect(result.started).toHaveLength(1);
    expect(dispatchNativeFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: result.started[0],
        workflowId: `function-${result.started[0]}`,
        profile,
      }),
    );
  });

  it('delivers persisted birth-pinned work even when current profile config is empty', async () => {
    dispatchNativeFunction.mockClear();
    const database = db();
    await expect(reconcilePersistedNativeFunctions(database)).resolves.toMatchObject({
      started: [expect.stringMatching(/^nf-/)],
    });
    expect(database.query).toHaveBeenCalled();
    expect(dispatchNativeFunction).toHaveBeenCalledOnce();
  });
});
