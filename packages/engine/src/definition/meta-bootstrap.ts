/**
 * Meta application-bundle bootstrap.
 *
 * 这是 kernel 与具体应用制品之间唯一的安装边界：调用方提供 unknown 数据，
 * 本模块完成解析、跨引用校验和幂等事件规划。它不知道 article/comment 等业务名，
 * 也不直接写数据库；安装结果仍是同一份可重放事件日志。
 */
import type {
  ApplicationDefinition,
  CapabilityDefinition,
  FlowDefinition,
  InstanceSnapshot,
} from '@ui4a/shared';
import { metaApplicationRel, metaCapabilityRel, metaFlowRel } from '@ui4a/shared';

import type {
  ApplicationSeededDetail,
  CapabilitySeededDetail,
  LogEvent,
  SeedDetail,
} from '../projection/fold/index';
import type { DefinitionSeededDetail } from './meta';
import { validateApplicationEntryReachability } from './application-entry/reachability';
import {
  parseApplicationDefinition,
  parseCapabilityDefinition,
  parseFlowDefinition,
} from '../core/parse';

export const APPLICATION_BUNDLE_SCHEMA = 'https://ui4a.dev/application-bundle/v1' as const;

export interface ApplicationBundle {
  schema: typeof APPLICATION_BUNDLE_SCHEMA;
  bundle: { name: string; version: number };
  applications: ApplicationDefinition[];
  capabilities: CapabilityDefinition[];
  flows: FlowDefinition[];
  seed: { rel: string; detail: SeedDetail };
}

export type MetaBootstrapEvent = Omit<LogEvent, 'seq' | 'ts'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`application bundle ${path} 必须是非空字符串`);
  }
  return value;
}

function uniqueByName<T extends { name: string }>(rows: T[], path: string): T[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (names.has(row.name))
      throw new Error(`application bundle ${path} 存在重复 name "${row.name}"`);
    names.add(row.name);
  }
  return rows;
}

function parseSeed(input: unknown): { rel: string; detail: SeedDetail } {
  if (!isRecord(input)) throw new Error('application bundle seed 必须是对象');
  const rel = nonEmptyString(input.rel, 'seed.rel');
  if (!isRecord(input.detail) || !isRecord(input.detail.instances)) {
    throw new Error('application bundle seed.detail.instances 必须是对象');
  }
  const instances: Record<string, InstanceSnapshot> = {};
  for (const [key, raw] of Object.entries(input.detail.instances)) {
    if (!isRecord(raw) || !isRecord(raw.fields)) {
      throw new Error(`application bundle seed instance "${key}" 形状非法`);
    }
    const instanceRel = nonEmptyString(raw.rel, `seed.instances.${key}.rel`);
    if (instanceRel !== key) {
      throw new Error(
        `application bundle seed instance key "${key}" 与 rel "${instanceRel}" 不一致`,
      );
    }
    instances[key] = {
      rel: instanceRel,
      flow: nonEmptyString(raw.flow, `seed.instances.${key}.flow`),
      node: nonEmptyString(raw.node, `seed.instances.${key}.node`),
      fields: raw.fields as InstanceSnapshot['fields'],
    };
  }
  let collections: Record<string, string[]> | undefined;
  if (input.detail.collections !== undefined) {
    if (!isRecord(input.detail.collections)) {
      throw new Error('application bundle seed.detail.collections 必须是对象');
    }
    collections = {};
    for (const [name, members] of Object.entries(input.detail.collections)) {
      if (!Array.isArray(members) || members.some((member) => typeof member !== 'string')) {
        throw new Error(`application bundle seed collection "${name}" 必须是字符串数组`);
      }
      collections[name] = [...members] as string[];
    }
  }
  return { rel, detail: { instances, ...(collections !== undefined ? { collections } : {}) } };
}

/** unknown 应用制品 → 规范化、跨引用完整的安装输入。 */
export function parseApplicationBundle(input: unknown): ApplicationBundle {
  if (!isRecord(input)) throw new Error('application bundle 必须是对象');
  if (input.schema !== APPLICATION_BUNDLE_SCHEMA) {
    throw new Error(`application bundle schema 必须是 ${APPLICATION_BUNDLE_SCHEMA}`);
  }
  if (!isRecord(input.bundle)) throw new Error('application bundle bundle 必须是对象');
  const name = nonEmptyString(input.bundle.name, 'bundle.name');
  const version = input.bundle.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new Error('application bundle bundle.version 必须是正整数');
  }
  if (
    !Array.isArray(input.applications) ||
    !Array.isArray(input.capabilities) ||
    !Array.isArray(input.flows)
  ) {
    throw new Error('application bundle applications/capabilities/flows 必须是数组');
  }

  const applications = uniqueByName(
    input.applications.map(parseApplicationDefinition),
    'applications',
  );
  const capabilities = uniqueByName(
    input.capabilities.map(parseCapabilityDefinition),
    'capabilities',
  );
  const flows = uniqueByName(input.flows.map(parseFlowDefinition), 'flows');
  const seed = parseSeed(input.seed);
  const applicationNames = new Set(applications.map((application) => application.name));
  const flowByName = new Map(flows.map((flow) => [flow.name, flow]));

  for (const flow of flows) {
    if (!applicationNames.has(flow.app ?? 'default')) {
      throw new Error(`application bundle flow "${flow.name}" 引用未知 application "${flow.app}"`);
    }
  }
  for (const [rel, instance] of Object.entries(seed.detail.instances)) {
    const flow = flowByName.get(instance.flow);
    if (flow === undefined) {
      throw new Error(`application bundle seed instance "${rel}" 引用未知 flow "${instance.flow}"`);
    }
    if (!flow.nodes.some((node) => node.name === instance.node)) {
      throw new Error(
        `application bundle seed instance "${rel}" 的 node "${instance.node}" 不属于 flow "${instance.flow}"`,
      );
    }
  }
  for (const [collection, members] of Object.entries(seed.detail.collections ?? {})) {
    for (const member of members) {
      if (seed.detail.instances[member] === undefined) {
        throw new Error(
          `application bundle seed collection "${collection}" 引用未知 instance "${member}"`,
        );
      }
    }
  }
  validateApplicationEntryReachability(applications, flows, seed.detail.instances);

  return {
    schema: APPLICATION_BUNDLE_SCHEMA,
    bundle: { name, version: version as number },
    applications,
    capabilities,
    flows,
    seed,
  };
}

function bootstrapRel(bundle: ApplicationBundle): string {
  return `meta/bootstrap:${bundle.bundle.name}@${bundle.bundle.version}`;
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

/**
 * 依据已有日志规划最小安装事件集。receipt 在场即整包幂等；无 receipt 的旧库按
 * 每类稳定 identity 补缺项，最后写 receipt，把迁移收口为可审计的 meta 动作。
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
    events.push({
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
    });
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

/** receipt 声明的安装清单必须能由日志本身完全证明；否则拒绝以代码制品回填。 */
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
      // 早期 receipt 没有 inventory；同 rel 的升级 receipt 在场即可安全兼容。
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
