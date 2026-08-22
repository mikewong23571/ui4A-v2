import { spawnSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, TEMPORAL_ADDRESS, withWorkerServer } from './server-kit';
import { isolatedEvalDatabaseUrl, loadLlmEvalProfile } from './story-eval-kit';

const [temporalHost = 'localhost', temporalPort = '7233'] = TEMPORAL_ADDRESS.split(':');
const temporalUp =
  spawnSync('nc', ['-z', temporalHost, temporalPort], { stdio: 'ignore' }).status === 0;

test.skip(!temporalUp, `Temporal dev server 不可达(${TEMPORAL_ADDRESS})`);
test.skip(process.env.RUN_LLM_EVAL !== '1', 'RUN_LLM_EVAL=1 is required');

test('U23: delegated worker uses the configured real model without fallback', async () => {
  test.setTimeout(240_000);
  const profile = loadLlmEvalProfile();
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());

  await withWorkerServer(async () => {
    const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 't15-delegated-profile',
        mode: 'delegated',
        driver: 'llm',
        goal: { verb: '当前有几篇文章？' },
      }),
    });
    expect(response.status).toBe(200);
    const dispatched = (await response.json()) as { delegationId: string; statusUrl: string };

    const deadline = Date.now() + 180_000;
    let detail: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      const status = await fetch(`${SCENARIO_BASE}${dispatched.statusUrl}`);
      if (status.status === 200) {
        detail = (await status.json()) as Record<string, unknown>;
        if (['completed', 'failed', 'max-steps'].includes(String(detail.status))) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(detail?.status).toBe('completed');
    expect(detail?.driverKind).toBe('llm');
    expect(detail?.model).toBe(profile.model);
    expect(String(detail?.summary)).toMatch(/(^|\D)2(\D|$)|两\s*篇|二\s*篇/);

    const eventResponse = await fetch(`${SCENARIO_BASE}/api/events?afterSeq=0`);
    const eventBody = (await eventResponse.json()) as {
      events?: { kind: string; rel: string; detail: Record<string, unknown> }[];
    };
    const started = eventBody.events?.find(
      (event) =>
        event.kind === 'delegation-started' &&
        event.rel === `delegation:${dispatched.delegationId}`,
    );
    expect(started?.detail).toMatchObject({ driverKind: 'llm', model: profile.model });
  });
});
