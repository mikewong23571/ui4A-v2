import { expect, test } from '@playwright/test';

import type { ClientViewReport } from '@ui4a/shared';

import { withWorkerStack, SCENARIO_BASE } from '../kits/server-kit';
import {
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  readEvalEntity,
  runEvalTurn,
} from '../kits/story-eval-kit';

test.skip(process.env.RUN_LLM_EVAL !== '1', 'RUN_LLM_EVAL=1 requires the configured provider');
test.beforeEach(() => {
  test.setTimeout(420_000);
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());
});

const nativeProfiles = JSON.stringify([
  {
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
  },
]);

function clientView(): ClientViewReport {
  return {
    schemaVersion: 2,
    presence: {
      clientInstanceId: 'capability-boundary-eval',
      site: 'workstation',
      scope: 'security',
      thread: null,
      focus: 'cve:CVE-2026-0001',
    },
  };
}

async function events(kind?: string) {
  const query = kind === undefined ? '' : `&kind=${encodeURIComponent(kind)}`;
  const response = await fetch(`${SCENARIO_BASE}/api/events?limit=100${query}`);
  expect(response.ok).toBe(true);
  return ((await response.json()) as { events: Array<Record<string, unknown>> }).events;
}

test('real Assistant selects the shared CVE Action and the Function result returns through callback', async ({}, info) => {
  const profile = loadLlmEvalProfile();
  let evidence: unknown;
  await withWorkerStack(
    async () => {
      const before = (await readEvalEntity(SCENARIO_BASE, 'cve:CVE-2026-0001')) as {
        properties: { node: string };
      };
      expect(before.properties.node).toBe('identified');
      const turn = await runEvalTurn(
        SCENARIO_BASE,
        'capability-boundary',
        'capability-boundary-1',
        '补充这个 CVE 的影响信息。',
        clientView(),
      );
      expect(turn.status).toBe(200);
      expect(turn.driver).toBe('llm');

      await expect
        .poll(
          async () => {
            const entity = (await readEvalEntity(SCENARIO_BASE, 'cve:CVE-2026-0001')) as {
              properties: { node: string };
            };
            return entity.properties.node;
          },
          { timeout: 60_000 },
        )
        .toBe('enriched');

      const [core, decisions, receipts] = await Promise.all([
        events(),
        events('agent-decision'),
        fetch(
          `${SCENARIO_BASE}/api/events?domain=capability&kind=function-execution-finalized&limit=10`,
        ).then(async (response) => {
          expect(response.ok).toBe(true);
          return ((await response.json()) as { events: Array<Record<string, unknown>> }).events;
        }),
      ]);
      expect(
        core.some(
          (event) =>
            event.kind === 'action-executed' &&
            event.rel === 'cve:CVE-2026-0001' &&
            event.action === 'enrich-impact' &&
            event.actor === 'agent',
        ),
      ).toBe(true);
      expect(
        decisions.some((event) => {
          const detail = event.detail as { op?: { kind?: string; action?: string } };
          return detail.op?.kind === 'exec' && detail.op.action === 'enrich-impact';
        }),
      ).toBe(true);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.detail).toMatchObject({
        capability: { name: 'cve.enrich' },
        outcome: { status: 'succeeded' },
        callback: { action: 'enrichment-succeeded', outcome: 'accepted' },
      });
      evidence = { model: profile.model, turn, decisions, receipt: receipts[0] };
    },
    {
      DATABASE_URL: isolatedEvalDatabaseUrl(),
      LLM_API_KEY: profile.apiKey,
      LLM_BASE_URL: profile.baseUrl,
      LLM_MODEL: profile.model,
      UI4A_NATIVE_FUNCTION_PROFILES: nativeProfiles,
      UI4A_CAPABILITY_CALLBACK_TOKEN: 'capability-boundary-eval-token',
      UI4A_PUBLIC_BASE_URL: SCENARIO_BASE,
    },
  );
  await info.attach('capability-boundary-real-llm.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
