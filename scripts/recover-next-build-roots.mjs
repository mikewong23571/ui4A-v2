// T55 FR5.2:.next* 构建根回收(常驻维护脚本,`pnpm next:recover-roots`)。
// apps/web 的 distDir 由 UI4A_DIST_DIR 注入(next.config.ts):`.next` 为 dev 主根,
// `.next-e2e` 为 Playwright 场景 server 根(e2e/kits/server-kit.ts 等)。历史 track
// 的探针/场景根(如 .next-e2e-probe/.next-t52probe)无人引用却占数 GB 磁盘;
// 本脚本删除白名单之外的 apps/web/.next* 目录,保持构建根数 ≤2。
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../apps/web');
const KEEP = new Set(['.next', '.next-e2e']);

const roots = readdirSync(WEB_DIR)
  .filter((name) => name.startsWith('.next'))
  .sort();
const stale = roots.filter((name) => !KEEP.has(name));

for (const name of stale) {
  const full = path.join(WEB_DIR, name);
  rmSync(full, { recursive: true, force: true });
  console.log(`removed ${path.relative(process.cwd(), full)}`);
}
console.log(`kept: ${[...KEEP].filter((k) => roots.includes(k)).join(', ') || '(none)'} — roots remaining: ${roots.length - stale.length}`);
if (stale.length === 0) console.log('nothing to recover');
