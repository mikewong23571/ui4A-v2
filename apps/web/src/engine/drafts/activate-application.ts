/**
 * application-bundle Draft 激活(T48 Phase 2 / D66.3)。
 *
 * 人类 approve 在 Draft 锁内重验后,用与启动 bootstrap 同源的 planMetaBootstrap
 * 规划最小安装事件集(application-seeded / capability-seeded / definition-seeded /
 * seed / meta-bootstrap-applied receipt,receipt 幂等去重内建于纯函数),交
 * acceptDraftWithCoreEvent 与 draft-accepted 同事务原子落库。新 app 出生即进
 * applications 全集,无需第二个权威状态源。
 *
 * 回调内必须重验(与 flow/agent 激活同纪律):
 * - payloadHash 对齐锁定版本(装载完整性另由 accept 事务核 SHA,此处再对齐一次);
 * - bundle 仍可解析且解析名等于 target;
 * - target 名尚未被任何路径占用(D71.5 烧毁集 log 口径:application-seeded ∪
 *   application-deprecated)——同名即双写者竞态或停用烧毁,判 stale 留痕(I6),
 *   绝不把冲突 bundle 部分并入库;
 * - 全量清单 fail-closed(D66.1,评审修复):制品可声明多个 application,
 *   任何已占用名称(applications 侧含烧毁名 / capabilities / flows)都判
 *   stale 留痕,不得按 bootstrap 幂等语义静默跳过部分安装。
 */
import {
  bundleInventoryConflicts,
  planMetaBootstrap,
  validateApplicationBundleDraft,
  type InstalledBundleNames,
} from '@ui4a/engine';
import { payloadSha256, type AtomicCoreMutationPlan } from '@ui4a/db/drafts';
import { readLog, type DbExecutor } from '@ui4a/db/events';
import type { DraftAggregate } from '@ui4a/shared';

import { BARE_TARGET_NAME } from './helpers';

/** Revalidated bundle installation plan; runs inside the accept transaction and Draft locks. */
export async function planApplicationBundleActivation(input: {
  client: DbExecutor;
  locked: DraftAggregate;
  payload: unknown;
}): Promise<AtomicCoreMutationPlan> {
  const { client, locked, payload } = input;
  if (locked.target === undefined) throw new Error('Draft target is missing');
  // 裸名守卫重验(T50 D69.4):与 create 同判——预守卫事件形状的带前缀
  // target(如 `application:` 前缀绕过 GAP-4)不得在激活时安装进库。
  if (!BARE_TARGET_NAME.test(locked.target)) {
    throw new Error('application bundle target must be a bare application name');
  }
  if (payloadSha256(payload) !== locked.versions[locked.activeVersion]?.payloadHash) {
    throw new Error('draft payload hash mismatch');
  }
  const validation = validateApplicationBundleDraft(payload);
  if (!validation.valid || validation.value === undefined) {
    throw new Error('draft is no longer valid');
  }
  if (validation.value.bundle.name !== locked.target) {
    throw new Error('draft is no longer valid');
  }
  // 同名安装互斥:与 flow 激活同型的 target 级事务锁;锁内重读日志判竞态。
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `application:${locked.target}`,
  ]);
  const log = await readLog(client);
  const eventName = (event: (typeof log)[number]): unknown =>
    (event.detail as { name?: unknown } | undefined)?.name;
  // D71.5 烧毁集(log 口径,显式双集):target 名占用 = application-seeded
  // (历史安装,事件永存)∪ application-deprecated(停用烧毁)。烧毁判在前——
  // seeded→deprecated 是正常次序,停用是更强的终局事实;显式计入停用事件名,
  // 防未来读面改为只查活跃表时漏掉烧毁侧。
  const burned = log.some(
    (event) => event.kind === 'application-deprecated' && eventName(event) === locked.target,
  );
  if (burned) {
    throw new Error(`draft stale: application name ${locked.target} is burned (deprecated)`);
  }
  const installed = log.some(
    (event) => event.kind === 'application-seeded' && eventName(event) === locked.target,
  );
  if (installed) {
    throw new Error(`draft stale: application ${locked.target} is installed concurrently`);
  }
  const seededNames = (kind: string): Set<string> =>
    new Set(
      log
        .filter((event) => event.kind === kind)
        .map((event) => (event.detail as { name?: unknown } | undefined)?.name)
        .filter((name): name is string => typeof name === 'string'),
    );
  const deprecatedNames = new Set(
    log
      .filter((event) => event.kind === 'application-deprecated')
      .map(eventName)
      .filter((name): name is string => typeof name === 'string'),
  );
  // 全量清单冲突的 applications 侧同口径(D71.5):seeded ∪ deprecated——
  // 停用不释放名字,声明的次级 application 名命中任一侧即冲突。
  const installedNames: InstalledBundleNames = {
    applications: new Set([...seededNames('application-seeded'), ...deprecatedNames]),
    capabilities: seededNames('capability-seeded'),
    flows: seededNames('definition-seeded'),
  };
  const conflicts = bundleInventoryConflicts(validation.value, installedNames);
  if (conflicts !== undefined) {
    throw new Error(
      `draft stale: bundle inventory conflicts with installed definitions ${JSON.stringify(conflicts)}`,
    );
  }
  return { events: planMetaBootstrap(validation.value, log) };
}
