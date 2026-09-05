// T56 S3 probe 5+6: clientView drift at send time + focus/keyboard behavior of the chat shell.
// Uses the same fetch shim (no LLM) so sends are deterministic; request postData is read
// from Playwright's request events (clientView is built by real client code before fetch).
import { createRequire } from 'node:module';
const require = createRequire('/Users/mike/projs/playground/ui4A-v2/package.json');
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:3110';
const THREAD = process.argv[2] ?? 't56s3-a2c71f';

const SHIM = `
window.__t56s3 = { streams: [] };
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const method = (init && init.method) || (input && input.method) || 'GET';
  if (!url.includes('/api/chat') || method !== 'POST') return realFetch(input, init);
  const body = init && init.body ? JSON.parse(init.body) : {};
  const turnId = body.turnId || 't-turn';
  const sessionId = body.sessionId || ('t56s3-cv-' + Math.random().toString(16).slice(2, 8));
  window.__t56s3.streams.push({ sessionId, turnId, clientView: body.clientView ?? null, goal: body.goal });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\\n\\n'));
      send({ type: 'session', sessionId, turnId });
      await new Promise((r) => setTimeout(r, 400));
      send({ type: 'step', turnId, step: 1, message: { role: 'assistant', text: '受控步骤 1' } });
      await new Promise((r) => setTimeout(r, 400));
      send({ type: 'final', turnId, payload: { sessionId, turnId, driver: 'llm', requestedDriver: 'llm', outcome: 'done', summary: null, steps: [], successes: [] } });
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(SHIM);
const page = await ctx.newPage();

const log = [];
const record = (step, data) => {
  log.push({ step, ...data });
  console.log(`[${step}] ${JSON.stringify(data)}`);
};

const THREAD_URL = `${BASE}/canvas?thread=${encodeURIComponent(THREAD)}&focus=${encodeURIComponent(`thread:${THREAD}`)}`;
await page.goto(THREAD_URL, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForSelector('[data-nav="local:chat-open"]', { timeout: 60_000 });

// ================= clientView drift =================
async function sendAndCapture(tag) {
  const before = await page.evaluate(() => window.__t56s3.streams.length);
  await page.fill('textarea[placeholder="输入目标…"]', `探针发送 ${tag}`);
  await page.click('[data-nav="local:chat-send"]');
  await page.waitForFunction(
    (n) => window.__t56s3.streams.length > n,
    before,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);
  return page.evaluate((i) => window.__t56s3.streams[i], before);
}

// open chat first (auto-dock), then move focus: send from thread-itself view
await page.click('[data-nav="local:chat-open"]');
await page.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 30_000 });
const cv1 = await sendAndCapture('at-thread-itself');
record('CV1-thread-itself', { url: page.url(), clientView: cv1.clientView });

// nav to object focus via desk workset entry link (plain <a> → hard navigation)
const deskEntry = page.locator('[data-nav^="local:desk-entry:"]').first();
if (await deskEntry.count()) {
  await deskEntry.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  // hard nav remounts the shell: chat collapses to FAB — reopen to continue
  const fab2 = page.locator('[data-nav="local:chat-open"]');
  const panelGone = (await page.locator('textarea[placeholder="输入目标…"]').count()) === 0;
  record('CV2a-desk-entry-nav', {
    url: page.url(),
    hardNavCollapsedPanel: panelGone,
    reopened: panelGone && (await fab2.count()) > 0,
  });
  if (panelGone && (await fab2.count())) {
    await fab2.click();
    await page.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 30_000 });
  }
  const draftAfterHardNav = await page.evaluate(() => {
    const ta = document.querySelector('textarea[placeholder="输入目标…"]');
    return ta ? ta.value : null;
  });
  const cv2 = await sendAndCapture('at-object-focus');
  record('CV2b-object-focus', { draftSurvivedHardNav: draftAfterHardNav === '', clientView: cv2.clientView });
} else {
  record('CV2-object-focus', { skipped: 'no desk entry link found' });
}

// client-side nav via header nav link (Next Link, root layout persists); thread param dropped
await page.click('[data-nav="canvas"]');
await page.waitForTimeout(1500);
const cv3 = await sendAndCapture('at-canvas-client-side');
record('CV3-canvas-client-side', { url: page.url(), clientView: cv3.clientView });

// hint near input: any live thread/object hint element in panel?
const hints = await page.evaluate((threadId) => {
  const text = document.body.innerText;
  return {
    hasCurrentlyViewing: text.includes('当前查看'),
    hasCurrentLine: text.includes('当前线'),
    mentionThread: text.includes(threadId),
  };
}, THREAD);
record('CV4-input-area-hints', hints);

// ================= focus / keyboard =================
// close and reopen panel, then inspect focus behavior
await page.goto(THREAD_URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-nav="local:chat-open"]', { timeout: 60_000 });
await page.keyboard.press('Tab'); // move focus somewhere first
await page.click('[data-nav="local:chat-open"]');
await page.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 30_000 });
const afterOpen = await page.evaluate(() => {
  const ae = document.activeElement;
  return {
    tag: ae?.tagName,
    aria: ae?.getAttribute('aria-label'),
    placeholder: ae?.getAttribute('placeholder') ?? null,
  };
});
record('K1-focus-after-open', afterOpen);

// Tab ring: collect first 8 tab stops inside the chat panel
const tabStops = await page.evaluate(() => {
  const panel = document.querySelector('textarea[placeholder="输入目标…"]')?.closest('div[class*="flex-col"]');
  const root = panel ?? document.body;
  const els = [...root.querySelectorAll('button, a, textarea, [tabindex]')].slice(0, 10);
  return els.map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-nav') ?? el.tagName);
});
record('K2-panel-tab-stops', { tabStops });

// focus-visible ring classes present on panel buttons?
const ringClasses = await page.evaluate(() => {
  const btn = document.querySelector('[data-nav="local:chat-new"]');
  return btn ? btn.className.includes('focus-visible') : false;
});
record('K3-focus-visible-class', { ringClasses });

// Escape behavior on float + sidebar
const floatBtn = page.locator('[data-nav="local:chat-float"]');
if (await floatBtn.count()) {
  await floatBtn.click();
  await page.waitForTimeout(300);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEscFloat = await page.evaluate(() => ({
  panelOpen: !!document.querySelector('textarea[placeholder="输入目标…"]') || !!document.querySelector('[data-nav="local:chat-close"]'),
}));
record('K4-escape-float', afterEscFloat);
await page.click('[data-nav="local:chat-dock"]');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEscSidebar = await page.evaluate(() => ({
  panelOpen: !!document.querySelector('textarea[placeholder="输入目标…"]') || !!document.querySelector('[data-nav="local:chat-close"]'),
}));
record('K5-escape-sidebar', afterEscSidebar);

// focus after close: where does focus land?
await page.click('textarea[placeholder="输入目标…"]');
await page.click('[data-nav="local:chat-close"]');
await page.waitForTimeout(300);
const afterClose = await page.evaluate(() => {
  const ae = document.activeElement;
  return { tag: ae?.tagName, aria: ae?.getAttribute('aria-label'), isBody: ae === document.body };
});
record('K6-focus-after-close', afterClose);

await browser.close();
console.log('--- JSON ---');
console.log(JSON.stringify(log, null, 1));
