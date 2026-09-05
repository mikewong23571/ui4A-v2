// T56 S3 probe 7: /chat page adopts the same localStorage sessionId (session identity continuity).
import { createRequire } from 'node:module';
const require = createRequire('/Users/mike/projs/playground/ui4A-v2/package.json');
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:3110';
const THREAD = process.argv[2] ?? 't56s3-a2c71f';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const log = [];

// reuse stored sessionId from prior probes (already in this fresh context? no — set explicitly)
await page.goto(`${BASE}/canvas?thread=${encodeURIComponent(THREAD)}`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('ui4a.chat.sessionId', 't56s3-shared-check-42'));
await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
await page.waitForSelector('textarea[placeholder="输入目标…"]', { timeout: 60_000 });
await page.waitForTimeout(1000);
const state = await page.evaluate(() => {
  const header = [...document.querySelectorAll('span')].find((s) => s.textContent.startsWith('会话 '));
  return { header: header?.textContent.trim() ?? null, ls: localStorage.getItem('ui4a.chat.sessionId') };
});
log.push({ step: 'chat-page-session', ...state });
console.log(JSON.stringify(log, null, 1));
await browser.close();
