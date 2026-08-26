/**
 * Opt-in real-LLM acceptance for the current Presentation Plane path.
 *
 * A structured clientView focuses the business article. The model must request `present`; the
 * web layer sends the thin intent through the Presentation Broker, records the governed receipt
 * and navigation, and exposes a canvas whose values are live contract facts. Text alone cannot
 * satisfy this test, and no fixed complete tool trace is asserted.
 */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

test.skip(
  !process.env.RUN_LLM_E2E ||
    !process.env.LLM_API_KEY ||
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL,
  'RUN_LLM_E2E 或 LLM provider profile 未完整设置(真实 Presentation 门控,默认 skip)',
);

test.beforeEach(() => {
  test.setTimeout(420_000);
});

const MAX_ROUNDS = 3;
const REQUEST = '请把当前这篇文章作为可阅读的画布视图展示出来，不要只在聊天里描述。';

interface PresentationReceipt {
  requestId: string;
  status: 'pending' | 'ready' | 'fallback' | 'failed';
  surfaceUrl?: string;
}

interface SseFrame {
  type: string;
  payload?: PresentationReceipt & {
    driver?: string;
    outcome?: string;
    presentationRequestIds?: string[];
  };
}

interface LoggedEvent {
  kind: string;
  rel: string | null;
  detail: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseSseFrames(raw: string): SseFrame[] {
  return raw
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as SseFrame);
}

async function readEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events?afterSeq=0`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events?: LoggedEvent[] }).events ?? [];
}

async function readArticle(): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent('post:first-post')}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

test('real Assistant present produces a governed receipt, navigation, and factual canvas', async ({
  page,
}) => {
  await withFreshServer(async () => {
    const before = await readArticle();
    const fields = record(record(before.properties)?.fields);
    expect(fields).toMatchObject({
      title: '第一篇',
      category: 'essay',
      body: expect.stringContaining('这是第一篇完整文章'),
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const reports: string[] = [];
    let terminal: PresentationReceipt | undefined;

    for (let round = 1; round <= MAX_ROUNDS && terminal === undefined; round += 1) {
      const sessionId = `presentation-live-${round}-${Date.now()}`;
      const turnId = `${sessionId}:turn-1`;
      const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          turnId,
          driver: 'llm',
          goal: { verb: REQUEST },
          clientView: {
            schemaVersion: 2,
            presence: {
              clientInstanceId: `presentation-live-${round}`,
              site: 'business',
              scope: 'default',
              thread: null,
              focus: 'post:first-post',
            },
          },
        }),
      });
      expect(response.status).toBe(200);
      const frames = parseSseFrames(await response.text());
      const final = frames.find((frame) => frame.type === 'final')?.payload;
      expect(final?.driver).toBe('llm');

      const receipts = frames
        .filter((frame) => frame.type === 'presentation')
        .flatMap((frame) => (frame.payload === undefined ? [] : [frame.payload]));
      const pending = receipts.find((receipt) => receipt.status === 'pending');
      const resolved = receipts.find(
        (receipt) => receipt.status === 'ready' || receipt.status === 'fallback',
      );
      reports.push(
        `#${round} outcome=${final?.outcome ?? '?'} pending=${pending?.requestId ?? 'none'} ` +
          `terminal=${resolved?.status ?? 'none'} url=${resolved?.surfaceUrl ?? 'none'}`,
      );
      if (resolved === undefined) continue;

      expect(pending?.requestId).toBe(resolved.requestId);
      expect(final?.presentationRequestIds).toContain(resolved.requestId);
      expect(resolved.surfaceUrl).toMatch(/^\/canvas\?/);

      const logged = await readEvents();
      const requested = logged.find(
        (event) =>
          event.kind === 'presentation-requested' &&
          record(event.detail)?.requestId === resolved.requestId,
      );
      const resolution = logged.find(
        (event) =>
          event.kind === 'presentation-resolved' &&
          record(event.detail)?.requestId === resolved.requestId,
      );
      expect(requested?.rel).toBe(`presentation:${resolved.requestId}`);
      expect(record(record(resolution?.detail)?.receipt)).toMatchObject({
        requestId: resolved.requestId,
        status: resolved.status,
        surfaceUrl: resolved.surfaceUrl,
      });

      const navigation = logged.find(
        (event) =>
          event.kind === 'chat-navigation-completed' &&
          record(event.detail)?.presentationRequestId === resolved.requestId,
      );
      expect(record(navigation?.detail)).toMatchObject({
        source: 'presentation-receipt',
        subject: 'post:first-post',
        route: resolved.surfaceUrl,
      });
      terminal = resolved;
    }

    console.log(`[presentation-live] ${reports.join('\n')}`);
    expect(
      terminal,
      `真实 LLM 必须至少请求一次可用 Presentation:\n${reports.join('\n')}`,
    ).toBeDefined();

    await page.goto(`${SCENARIO_BASE}${terminal!.surfaceUrl!}`);
    await expect(page.locator('[data-surface][data-active="true"]').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: String(fields!.title), exact: true }),
    ).toBeVisible();
    await expect(page.getByText(String(fields!.body))).toBeVisible();
    await expect(page.getByText(String(fields!.category), { exact: true })).toBeVisible();
    expect(await page.locator('[data-testid="canvas-errors"] li').allTextContents()).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(await readArticle()).toEqual(before);
  });
});
