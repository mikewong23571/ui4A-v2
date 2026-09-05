// T56 S3 probe 4: controlled SSE (fetch shim) — stream survives layout switches; stop reachable.
// The shim replaces window.fetch ONLY for POST /api/chat and emits protocol-correct frames
// (session → steps @700ms → final). Everything downstream is the real client state machine.
import { createRequire } from 'node:module';
const require = createRequire('/Users/mike/projs/playground/ui4A-v2/package.json');
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:3110';
const THREAD = process.argv[2] ?? 't56s3-a2c71f';
const SHOTS = '/Users/mike/projs/playground/ui4A-v2/conductor/tracks/t56-work-thread-workspace_20260905/probes/shots';

const SHIM = `
window.__t56s3 = { streams: [], aborted: 0, completed: 0 };
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const method = (init && init.method) || (input && input.method) || 'GET';
  if (!url.includes('/api/chat') || method !== 'POST') return realFetch(input, init);
  const body = init && init.body ? JSON.parse(init.body) : {};
  const turnId = body.turnId || 't-turn';
  const sessionId = 't56s3-sse-' + Math.random().toString(16).slice(2, 8);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const rec = { sessionId, turnId, done: false };
      window.__t56s3.streams.push(rec);
      const send = (obj) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\\n\\n'));
      send({ type: 'session', sessionId, turnId });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        for (let i = 1; i <= 12; i++) {
          await sleep(700);
          if (controller.desiredSize === null || rec.aborted) break;
          send({ type: 'step', turnId, step: i, message: { role: 'assistant', text: '受控步骤 ' + i + '/12' } });
        }
        if (!rec.aborted) {
          send({ type: 'final', turnId, payload: { sessionId, turnId, driver: 'llm', requestedDriver: 'llm', outcome: 'done', summary: '受控流完成', steps: [], successes: [] } });
          rec.completed = true;
          window.__t56s3.completed++;
        }
        rec.done = true;
        controller.close();
      } catch (e) {
        rec.error = String(e);
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      window.__t56s3.aborted++;
      const rec = window.__t56s3.streams[window.__t56s3.streams.length - 1];
      if (rec) rec.aborted = true;
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
function record(step, data) {
  log.push({ step, ...data });
  console.log(`[${step}] ${JSON.stringify(data)}`);
}

async function chatSnap(tag) {
  return page.evaluate((t) => {
    const ta = document.querySelector('textarea[placeholder="输入目标…"]');
    const stop = document.querySelector('[data-nav="local:chat-cancel"]');
    const send = document.querySelector('[data-nav="local:chat-send"]');
    const msgs = [...document.querySelectorAll('[data-testid="assistant-message"], [data-role="assistant"]')];
    const allText = document.body.innerText;
    return {
      step: t,
      composerPresent: !!ta,
      stopVisible: !!stop,
      sendVisible: !!send,
      streamCount: window.__t56s3.streams.length,
      completed: window.__t56s3.completed,
      aborted: window.__t56s3.aborted,
      lsSessionId: localStorage.getItem('ui4a.chat.sessionId'),
      panelTextHas: (s) => allText.includes(s),
    };
  }, tag);
}

const THREAD_URL = `${BASE}/canvas?thread=${encodeURIComponent(THREAD)}&focus=${encodeURIComponent(`thread:${THREAD}`)}`;
await page.goto(THREAD_URL, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForSelector('[data-nav="local:chat-open"]', { timeout: 60_000 });
await page.click('[data-nav="local:chat-open"]');
await page.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 30_000 });

// ---- send while sidebar docked; switch layouts mid-stream ----
await page.fill('textarea[placeholder="输入目标…"]', '受控SSE:流式期间切布局');
await page.click('[data-nav="local:chat-send"]');
await page.waitForTimeout(800); // ~1 step arrived
record('A-streaming-sidebar', await chatSnap('A'));
await page.screenshot({ path: `${SHOTS}/sse-1-streaming-sidebar.png` });

// close panel mid-stream
await page.click('[data-nav="local:chat-close"]');
await page.waitForTimeout(600);
record('B-closed-midstream', await chatSnap('B'));

// reopen (float default per loadMode) mid-stream
await page.click('[data-nav="local:chat-open"]');
await page.waitForTimeout(600);
record('C-reopened-float-midstream', await chatSnap('C'));

// dock to sidebar mid-stream
await page.click('[data-nav="local:chat-dock"]');
await page.waitForTimeout(600);
record('D-docked-midstream', await chatSnap('D'));

// client-side nav away mid-stream
await page.click('[data-nav="local:application-directory"]');
await page.waitForTimeout(1000);
record('E-navaway-midstream', { url: page.url(), ...(await chatSnap('E')) });

// back mid-stream
await page.goBack();
await page.waitForTimeout(800);
record('F-back-midstream', await chatSnap('F'));

// wait for stream to finish (12 steps × 700ms ≈ 8.4s total)
await page.waitForTimeout(6000);
record('G-after-complete', await chatSnap('G'));
const finalText = await page.evaluate(() => document.body.innerText.includes('受控流完成'));
record('G2-final-frame-landed', { finalText });
await page.screenshot({ path: `${SHOTS}/sse-2-after-complete.png` });

// ---- second turn: click stop mid-stream ----
await page.fill('textarea[placeholder="输入目标…"]', '受控SSE:停止按钮');
await page.click('[data-nav="local:chat-send"]');
await page.waitForTimeout(1600);
const mid = await chatSnap('H-midstream-stop');
record('H-midstream-before-stop', mid);
await page.click('[data-nav="local:chat-cancel"]');
await page.waitForTimeout(600);
record('I-after-stop-click', await chatSnap('I'));
const stoppedText = await page.evaluate(() => document.body.innerText.includes('已停止'));
record('I2-stop-wording', { stoppedText, shimAborted: await page.evaluate(() => window.__t56s3.aborted) });
await page.screenshot({ path: `${SHOTS}/sse-3-after-stop.png` });

// ---- third turn: stream while resizing to 390 (overlay squeeze) ----
await page.fill('textarea[placeholder="输入目标…"]', '受控SSE:窄屏流式');
await page.click('[data-nav="local:chat-send"]');
await page.waitForTimeout(900);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const narrow = await page.evaluate(() => ({
  stopVisible: !!document.querySelector('[data-nav="local:chat-cancel"]'),
  stopInView: (() => {
    const el = document.querySelector('[data-nav="local:chat-cancel"]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.x >= 0 && r.y >= 0 && r.x + r.width <= window.innerWidth && r.y + r.height <= window.innerHeight;
  })(),
  hscroll: document.documentElement.scrollWidth > window.innerWidth,
  chatX: (() => { const c = [...document.querySelectorAll('aside')].find(a => a.className.includes('border-l')); return c ? Math.round(c.getBoundingClientRect().x) : null; })(),
}));
record('J-narrow-390-streaming', narrow);
await page.screenshot({ path: `${SHOTS}/sse-4-narrow-390-streaming.png` });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1500);
record('K-wide-after-narrow', await chatSnap('K'));

await browser.close();
console.log('--- JSON ---');
console.log(JSON.stringify(log, null, 1));
