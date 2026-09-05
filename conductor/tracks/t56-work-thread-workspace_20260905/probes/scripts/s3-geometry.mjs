// T56 S3 probe 2: gaze column width, header truncation, h1/h2 inventory, focus=object variant.
import { createRequire } from 'node:module';
const require = createRequire('/Users/mike/projs/playground/ui4A-v2/package.json');
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:3110';
const THREAD = process.argv[2] ?? 't56s3-a2c71f';
const SHOTS = '/Users/mike/projs/playground/ui4A-v2/conductor/tracks/t56-work-thread-workspace_20260905/probes/shots';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1080x820', width: 1080, height: 820 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '1920x1080@200pct', width: 960, height: 540, deviceScaleFactor: 2 },
];

async function measure(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const rail = document.querySelector('[data-testid="thread-desk-rail"]');
    const gazeCol = rail ? rail.nextElementSibling : null;
    const headerInner = document.querySelector('header > div');
    const chatAside = [...document.querySelectorAll('aside')].find(
      (a) => a.className.includes('border-l') && a.className.includes('w-96'),
    );
    return {
      vw: window.innerWidth,
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
      docSW: document.documentElement.scrollWidth,
      rail: box(rail),
      gazeCol: box(gazeCol),
      headerTruncated: headerInner ? headerInner.scrollWidth > headerInner.clientWidth : null,
      headerSW: headerInner?.scrollWidth ?? null,
      headerCW: headerInner?.clientWidth ?? null,
      chat: box(chatAside),
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 24)),
      h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim().slice(0, 24)).slice(0, 12),
    };
  });
}

const browser = await chromium.launch();
const out = {};
for (const routeName of ['thread-itself', 'focus-object']) {
  out[routeName] = {};
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.deviceScaleFactor ? { deviceScaleFactor: vp.deviceScaleFactor } : {}),
    });
    const page = await ctx.newPage();
    const focus =
      routeName === 'thread-itself' ? `thread:${THREAD}` : 'articles';
    await page
      .goto(`${BASE}/canvas?thread=${encodeURIComponent(THREAD)}&focus=${encodeURIComponent(focus)}`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      })
      .catch(() => page.waitForTimeout(4000));
    await page.waitForSelector('main', { timeout: 60_000 });
    await page.waitForTimeout(500);
    const closed = await measure(page);
    await page.screenshot({ path: `${SHOTS}/${vp.name}-${routeName}-closed.png` });
    const fab = page.locator('[data-nav="local:chat-open"]');
    if ((await fab.count()) > 0) {
      await fab.click();
      await page.waitForTimeout(600);
    }
    const open = await measure(page);
    await page.screenshot({ path: `${SHOTS}/${vp.name}-${routeName}-chat.png` });
    out[routeName][vp.name] = { closed, open };
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
