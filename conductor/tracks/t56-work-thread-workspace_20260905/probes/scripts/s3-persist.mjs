// T56 S3 probe 3: draft / session / running-state persistence across layout switches.
// Real UI on isolated 3110 server. No messages sent here (SSE probe is separate);
// "running" state is only observable during a stream, so this probe tracks draft + sessionId.
import { createRequire } from 'node:module';
const require = createRequire('/Users/mike/projs/playground/ui4A-v2/package.json');
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:3110';
const THREAD = process.argv[2] ?? 't56s3-a2c71f';
const DRAFT = 'T56S3 草稿-未发送文本,验证跨布局存续';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const log = [];
function record(step, data) {
  log.push({ step, ...data });
  console.log(`[${step}] ${JSON.stringify(data)}`);
}

async function chatState(tag) {
  return page.evaluate((t) => {
    const ta = document.querySelector('textarea[placeholder="输入目标…"]');
    const header = [...document.querySelectorAll('span')].find((s) =>
      s.textContent.startsWith('会话 '),
    );
    return {
      step: t,
      composerPresent: ta !== null,
      draft: ta ? ta.value : null,
      headerSession: header ? header.textContent.trim() : null,
      lsSessionId: localStorage.getItem('ui4a.chat.sessionId'),
      openButton: document.querySelector('[data-nav="local:chat-open"]') !== null,
      panelVisible:
        document.querySelector('[data-nav="local:chat-close"]') !== null ||
        document.querySelector('textarea[placeholder="输入目标…"]') !== null,
    };
  }, tag);
}

const THREAD_URL = `${BASE}/canvas?thread=${encodeURIComponent(THREAD)}&focus=${encodeURIComponent(`thread:${THREAD}`)}`;

// ---- setup: open thread page, open chat (auto-dock sidebar), type draft ----
await page.goto(THREAD_URL, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForSelector('[data-nav="local:chat-open"]', { timeout: 60_000 });
await page.click('[data-nav="local:chat-open"]');
await page.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 30_000 });
await page.fill('textarea[placeholder="输入目标…"]', DRAFT);
await page.waitForTimeout(300);
record('0-typed', await chatState('0-typed'));

// ---- 1. client-side focus switch via shell nav link (Next Link, root layout stays) ----
await page.click('[data-nav="local:application-directory"]');
await page.waitForTimeout(1200);
record('1-after-clientside-nav', { url: page.url(), ...(await chatState('1')) });

// ---- 2. browser back (popstate) ----
await page.goBack();
await page.waitForTimeout(1200);
record('2-after-back', { url: page.url(), ...(await chatState('2')) });

// ---- 3. close panel (X) and reopen via FAB ----
await page.click('[data-nav="local:chat-close"]');
await page.waitForTimeout(400);
record('3-closed', await chatState('3-closed'));
await page.click('[data-nav="local:chat-open"]');
await page.waitForTimeout(600);
record('3-reopened', await chatState('3-reopened'));

// ---- 4. sidebar -> float -> sidebar toggles ----
const floatBtn = page.locator('[data-nav="local:chat-float"]');
if (await floatBtn.count()) {
  await floatBtn.click();
  await page.waitForTimeout(400);
  record('4a-float', await chatState('4a-float'));
  await page.click('[data-nav="local:chat-dock"]');
  await page.waitForTimeout(400);
  record('4b-dock-again', await chatState('4b-dock-again'));
}

// ---- 5. resize window (1440 -> 1000 -> 390 -> 1440) ----
await page.setViewportSize({ width: 1000, height: 800 });
await page.waitForTimeout(400);
record('5a-resize-1000', await chatState('5a'));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
record('5b-resize-390', await chatState('5b'));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
record('5c-resize-back-1440', await chatState('5c'));

// ---- 6. popout: window.open('/chat'); popup is a separate document/instance ----
const [popup] = await Promise.all([
  page.waitForEvent('popup', { timeout: 10_000 }),
  page.click('[data-nav="local:chat-popout"]'),
]);
await popup.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 60_000 });
await popup.waitForTimeout(800);
const popDraft = await popup.evaluate(() => {
  const ta = document.querySelector('textarea[placeholder="输入目标…"]');
  const header = [...document.querySelectorAll('span')].find((s) =>
    s.textContent.startsWith('会话 '),
  );
  return {
    draft: ta ? ta.value : null,
    headerSession: header ? header.textContent.trim() : null,
    lsSessionId: localStorage.getItem('ui4a.chat.sessionId'),
  };
});
record('6a-popup-fresh', popDraft);
// type a different draft in popup, close popup, check opener still has its own draft
await popup.fill('textarea[placeholder="输入目标…"]', '弹窗侧输入');
await popup.waitForTimeout(200);
await popup.close();
await page.waitForTimeout(300);
record('6b-opener-after-popup-close', await chatState('6b'));

// ---- 7. full page reload ----
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
// chat starts closed after reload; reopen
const fabAfter = page.locator('[data-nav="local:chat-open"]');
if (await fabAfter.count()) {
  await fabAfter.click();
  await page.waitForTimeout(800);
}
record('7-after-reload', await chatState('7'));

// ---- 8. hard navigation to /chat and back ----
await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const chatPageState = await page.evaluate(() => {
  const ta = document.querySelector('textarea[placeholder="输入目标…"]');
  const header = [...document.querySelectorAll('span')].find((s) =>
    s.textContent.startsWith('会话 '),
  );
  return {
    draft: ta ? ta.value : null,
    headerSession: header ? header.textContent.trim() : null,
    lsSessionId: localStorage.getItem('ui4a.chat.sessionId'),
  };
});
record('8a-at-chat-page', chatPageState);
await page.goto(THREAD_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const fabBack = page.locator('[data-nav="local:chat-open"]');
if (await fabBack.count()) {
  await fabBack.click();
  await page.waitForTimeout(800);
}
record('8b-back-to-thread', await chatState('8b'));

await browser.close();
console.log('--- JSON ---');
console.log(JSON.stringify(log, null, 1));
