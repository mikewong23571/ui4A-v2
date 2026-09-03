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
 * - target 名尚未被任何路径安装——同名即双写者竞态,判 stale 留痕(I6),
 *   绝不把冲突 bundle 部分并入库。
 */
import { planMetaBootstrap, validateApplicationBundleDraft } from '@ui4a/engine';
import { payloadSha256, type AtomicCoreMutationPlan } from '@ui4a/db/drafts';
import { readLog, type DbExecutor } from '@ui4a/db/events';
import type { DraftAggregate } from '@ui4a/shared';

/** Revalidated bundle installation plan; runs inside the accept transaction and Draft locks. */
export async function planApplicationBundleActivation(input: {
  client: DbExecutor;
  locked: DraftAggregate;
  payload: unknown;
}): Promise<AtomicCoreMutationPlan> {
  const { client, locked, payload } = input;
  if (locked.target === undefined) throw new Error('Draft target is missing');
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
  const installed = log.some(
    (event) =>
      event.kind === 'application-seeded' &&
      (event.detail as { name?: unknown } | undefined)?.name === locked.target,
  );
  if (installed) {
    throw new Error(`draft stale: application ${locked.target} is installed concurrently`);
  }
  return { events: planMetaBootstrap(validation.value, log) };
}
