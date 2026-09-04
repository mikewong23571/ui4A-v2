/**
 * Meta application-bundle bootstrap.
 *
 * 这是 kernel 与具体应用制品之间唯一的安装边界:调用方提供 unknown 数据,
 * 制品解析与结构化拒绝(D69.3)住在 bundle/payload-issues,本模块负责依据
 * 已有日志规划幂等安装事件与 receipt 完整性核验。它不知道 article/comment
 * 等业务名,也不直接写数据库;安装结果仍是同一份可重放事件日志。
 */
import type { FlowDefinition } from '@ui4a/shared';
import { metaApplicationRel, metaCapabilityRel, metaFlowRel } from '@ui4a/shared';

import type { ApplicationBundle } from './bundle/payload-issues';
import type {
  ApplicationSeededDetail,
  CapabilitySeededDetail,
  LogEvent,
} from '../projection/fold/index';
import type { DefinitionSeededDetail } from './meta';

// 安装边界解析合同(T50 起住在 bundle/payload-issues);此处保持原导入路径稳定。
export {
  APPLICATION_BUNDLE_SCHEMA,
  applicationBundleIssues,
  parseApplicationBundle,
  type ApplicationBundle,
  type ApplicationBundleIssue,
} from './bundle/payload-issues';

export type MetaBootstrapEvent = Omit<LogEvent, 'seq' | 'ts'>;

function bootstrapRel(bundle: ApplicationBundle): string {
  return `meta/bootstrap:${bundle.bundle.name}@${bundle.bundle.version}`;
}

/**
 * 单个 flow 的出生事件(definition-seeded v1/active):启动 bootstrap 与
 * flow-genesis Draft 激活(T48 Phase 4 / D67.3)共用同一构造器——
 * 全系统只有这一种 flow 出生事件的 kind/rel/detail 形状。
 */
export function flowSeedEvent(flow: FlowDefinition): MetaBootstrapEvent {
  return {
    kind: 'definition-seeded',
    rel: metaFlowRel(flow.name),
    actor: 'agent',
    principal: 'system:meta-bootstrap',
    channel: 'meta',
    detail: {
      name: flow.name,
      version: 1,
      status: 'active',
      definition: flow,
    } satisfies DefinitionSeededDetail,
  };
}

function receiptInventory(
  detail: unknown,
):
  | { applications: unknown[]; capabilities: unknown[]; flows: unknown[]; seedRel: string }
  | undefined {
  if (!isRecord(detail) || !isRecord(detail.inventory)) return undefined;
  const inventory = detail.inventory;
  if (
    !Array.isArray(inventory.applications) ||
    !Array.isArray(inventory.capabilities) ||
    !Array.isArray(inventory.flows) ||
    typeof inventory.seedRel !== 'string'
  ) {
    return undefined;
  }
  return {
    applications: inventory.applications,
    capabilities: inventory.capabilities,
    flows: inventory.flows,
    seedRel: inventory.seedRel,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 依据已有日志规划最小安装事件集。receipt 在场即整包幂等;无 receipt 的旧库按
 * 每类稳定 identity 补缺项,最后写 receipt,把迁移收口为可审计的 meta 动作。
 */
export function planMetaBootstrap(
  bundle: ApplicationBundle,
  existing: readonly LogEvent[],
): MetaBootstrapEvent[] {
  const receiptRel = bootstrapRel(bundle);
  if (
    existing.some(
      (event) =>
        event.kind === 'meta-bootstrap-applied' &&
        event.rel === receiptRel &&
        receiptInventory(event.detail) !== undefined,
    )
  ) {
    return [];
  }
  const applications = new Set(
    existing
      .filter((event) => event.kind === 'application-seeded')
      .map((event) => (event.detail as Partial<ApplicationSeededDetail> | undefined)?.name),
  );
  const capabilities = new Set(
    existing
      .filter((event) => event.kind === 'capability-seeded')
      .map((event) => (event.detail as Partial<CapabilitySeededDetail> | undefined)?.name),
  );
  const flows = new Set(
    existing
      .filter((event) => event.kind === 'definition-seeded')
      .map((event) => (event.detail as Partial<DefinitionSeededDetail> | undefined)?.name),
  );
  const seedPresent = existing.some(
    (event) => event.kind === 'seed' && event.rel === bundle.seed.rel,
  );
  const events: MetaBootstrapEvent[] = [];
  let applicationCount = 0;
  let capabilityCount = 0;
  let flowCount = 0;

  for (const application of bundle.applications) {
    if (applications.has(application.name)) continue;
    applicationCount += 1;
    events.push({
      kind: 'application-seeded',
      rel: metaApplicationRel(application.name),
      actor: 'agent',
      principal: 'system:meta-bootstrap',
      channel: 'meta',
      detail: { name: application.name, definition: application } satisfies ApplicationSeededDetail,
    });
  }
  for (const capability of bundle.capabilities) {
    if (capabilities.has(capability.name)) continue;
    capabilityCount += 1;
    events.push({
      kind: 'capability-seeded',
      rel: metaCapabilityRel(capability.name),
      actor: 'agent',
      principal: 'system:meta-bootstrap',
      channel: 'meta',
      detail: { name: capability.name, definition: capability } satisfies CapabilitySeededDetail,
    });
  }
  for (const flow of bundle.flows) {
    if (flows.has(flow.name)) continue;
    flowCount += 1;
    events.push(flowSeedEvent(flow));
  }
  if (!seedPresent) {
    events.push({
      kind: 'seed',
      rel: bundle.seed.rel,
      actor: 'agent',
      principal: 'system:meta-bootstrap',
      channel: 'meta',
      detail: bundle.seed.detail,
    });
  }
  events.push({
    kind: 'meta-bootstrap-applied',
    rel: receiptRel,
    actor: 'agent',
    principal: 'system:meta-bootstrap',
    channel: 'meta',
    detail: {
      schema: bundle.schema,
      bundle: bundle.bundle,
      installed: {
        applications: applicationCount,
        capabilities: capabilityCount,
        flows: flowCount,
        seed: !seedPresent,
      },
      inventory: {
        applications: bundle.applications.map((application) => application.name),
        capabilities: bundle.capabilities.map((capability) => capability.name),
        flows: bundle.flows.map((flow) => flow.name),
        seedRel: bundle.seed.rel,
      },
    },
  });
  return events;
}

/** receipt 声明的安装清单必须能由日志本身完全证明;否则拒绝以代码制品回填。 */
export function assertMetaBootstrapIntegrity(events: readonly LogEvent[]): void {
  const applicationNames = new Set(
    events
      .filter((event) => event.kind === 'application-seeded')
      .map((event) => (event.detail as Partial<ApplicationSeededDetail> | undefined)?.name),
  );
  const capabilityNames = new Set(
    events
      .filter((event) => event.kind === 'capability-seeded')
      .map((event) => (event.detail as Partial<CapabilitySeededDetail> | undefined)?.name),
  );
  const flowNames = new Set(
    events
      .filter((event) => event.kind === 'definition-seeded')
      .map((event) => (event.detail as Partial<DefinitionSeededDetail> | undefined)?.name),
  );
  const seedRels = new Set(
    events.filter((event) => event.kind === 'seed').map((event) => event.rel),
  );

  const receipts = events.filter((event) => event.kind === 'meta-bootstrap-applied');
  const upgradedRels = new Set(
    receipts
      .filter((receipt) => receiptInventory(receipt.detail) !== undefined)
      .map((receipt) => receipt.rel),
  );
  for (const receipt of receipts) {
    const inventory = receiptInventory(receipt.detail);
    if (inventory === undefined) {
      // 早期 receipt 没有 inventory;同 rel 的升级 receipt 在场即可安全兼容。
      if (!upgradedRels.has(receipt.rel)) {
        throw new Error(`meta bootstrap receipt "${receipt.rel ?? ''}" 缺少完整 inventory`);
      }
      continue;
    }
    const missingApplications = inventory.applications.filter(
      (name): name is string => typeof name === 'string' && !applicationNames.has(name),
    );
    const missingCapabilities = inventory.capabilities.filter(
      (name): name is string => typeof name === 'string' && !capabilityNames.has(name),
    );
    const missingFlows = inventory.flows.filter(
      (name): name is string => typeof name === 'string' && !flowNames.has(name),
    );
    if (
      missingApplications.length > 0 ||
      missingCapabilities.length > 0 ||
      missingFlows.length > 0
    ) {
      throw new Error(
        `runtime 定义缺失: applications=[${missingApplications.join(',')}], capabilities=[${missingCapabilities.join(',')}], flows=[${missingFlows.join(',')}]`,
      );
    }
    if (!seedRels.has(inventory.seedRel)) {
      throw new Error(`runtime seed 缺失: "${inventory.seedRel}"`);
    }
  }
}
