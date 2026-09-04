/**
 * application bundle payload 的解析与结构化拒绝通道(T50 Phase 2 / D69.3)。
 *
 * 这是 kernel 与具体应用制品之间安装边界的解析真相:unknown 数据在此完成结构
 * 检查、子定义解析与跨引用校验。T50 起,逐项检查不再直接 throw,而是一次性
 * 收集结构化问题 {code, path, message, expected}(path 精确到 seed.instances.<key>
 * 等,message 保持机械原文,expected 只做形状描述)。对外两条通道共享同一次
 * 走查、零重复真相:
 * - 抛出式 parseApplicationBundle:按首条问题原文抛出,公共行为零变化;
 * - applicationBundleIssues:供 validateApplicationBundleDraft 透传的伴生通道。
 */
import type {
  ApplicationDefinition,
  CapabilityDefinition,
  FlowDefinition,
  InstanceSnapshot,
} from '@ui4a/shared';

import type { SeedDetail } from '../../projection/fold/index';
import { validateApplicationEntryReachability } from '../application-entry/reachability';
import {
  parseApplicationDefinition,
  parseCapabilityDefinition,
  parseFlowDefinition,
} from '../../core/parse';

export const APPLICATION_BUNDLE_SCHEMA = 'https://ui4a.dev/application-bundle/v1' as const;

export interface ApplicationBundle {
  schema: typeof APPLICATION_BUNDLE_SCHEMA;
  bundle: { name: string; version: number };
  applications: ApplicationDefinition[];
  capabilities: CapabilityDefinition[];
  flows: FlowDefinition[];
  seed: { rel: string; detail: SeedDetail };
}

/** 结构化拒绝问题(D69.3):机械 message 保持原文,expected 是期望形状描述。 */
export interface ApplicationBundleIssue {
  code: string;
  path: string;
  message: string;
  expected?: unknown;
  /**
   * @internal 被包装的原始抛出错误(元素级子解析器/可达性守卫):
   * parseApplicationBundle 原样重抛以保持错误类型不变,不进入 Draft 校验合同。
   */
  cause?: unknown;
}

interface BundleInspection {
  issues: ApplicationBundleIssue[];
  value?: ApplicationBundle;
}

const EXPECTED_OBJECT = { type: 'object' } as const;
const EXPECTED_NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;
const EXPECTED_BUNDLE = { type: 'object', required: ['name', 'version'] } as const;
const EXPECTED_VERSION = { type: 'integer', minimum: 1 } as const;
const EXPECTED_ARRAY = { type: 'array' } as const;
const EXPECTED_SEED = { type: 'object', required: ['rel', 'detail'] } as const;
const EXPECTED_SEED_INSTANCE = {
  required: ['rel', 'flow', 'node', 'fields'],
  note: 'key 必须等于 rel',
} as const;
const EXPECTED_STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * seed 走查:与原 parseSeed 同一检查序列(rel → detail.instances → 逐条目
 * 形状/rel/key=rel/flow/node → collections),一次性收集全部问题;完全干净时
 * 返回规范化结果。
 */
function inspectSeed(
  input: unknown,
  issues: ApplicationBundleIssue[],
): { rel: string; detail: SeedDetail } | undefined {
  if (!isRecord(input)) {
    issues.push({
      code: 'parse-error',
      path: 'seed',
      message: 'application bundle seed 必须是对象',
      expected: EXPECTED_SEED,
    });
    return undefined;
  }
  let ok = true;
  let rel: string | undefined;
  if (typeof input.rel === 'string' && input.rel !== '') {
    rel = input.rel;
  } else {
    issues.push({
      code: 'parse-error',
      path: 'seed.rel',
      message: 'application bundle seed.rel 必须是非空字符串',
      expected: EXPECTED_NON_EMPTY_STRING,
    });
    ok = false;
  }
  const detail = input.detail;
  if (!isRecord(detail) || !isRecord(detail.instances)) {
    issues.push({
      code: 'parse-error',
      path: 'seed.detail.instances',
      message: 'application bundle seed.detail.instances 必须是对象',
      expected: EXPECTED_OBJECT,
    });
    return undefined;
  }
  const instances: Record<string, InstanceSnapshot> = {};
  for (const [key, raw] of Object.entries(detail.instances)) {
    if (!isRecord(raw) || !isRecord(raw.fields)) {
      issues.push({
        code: 'parse-error',
        path: `seed.instances.${key}`,
        message: `application bundle seed instance "${key}" 形状非法`,
        expected: EXPECTED_SEED_INSTANCE,
      });
      ok = false;
      continue;
    }
    const instanceRel = raw.rel;
    if (typeof instanceRel !== 'string' || instanceRel === '') {
      issues.push({
        code: 'parse-error',
        path: `seed.instances.${key}.rel`,
        message: `application bundle seed.instances.${key}.rel 必须是非空字符串`,
        expected: EXPECTED_NON_EMPTY_STRING,
      });
      ok = false;
      continue;
    }
    if (instanceRel !== key) {
      issues.push({
        code: 'parse-error',
        path: `seed.instances.${key}`,
        message: `application bundle seed instance key "${key}" 与 rel "${instanceRel}" 不一致`,
        expected: key,
      });
      ok = false;
      continue;
    }
    let flow: string | undefined;
    let node: string | undefined;
    if (typeof raw.flow === 'string' && raw.flow !== '') {
      flow = raw.flow;
    } else {
      issues.push({
        code: 'parse-error',
        path: `seed.instances.${key}.flow`,
        message: `application bundle seed.instances.${key}.flow 必须是非空字符串`,
        expected: EXPECTED_NON_EMPTY_STRING,
      });
      ok = false;
    }
    if (typeof raw.node === 'string' && raw.node !== '') {
      node = raw.node;
    } else {
      issues.push({
        code: 'parse-error',
        path: `seed.instances.${key}.node`,
        message: `application bundle seed.instances.${key}.node 必须是非空字符串`,
        expected: EXPECTED_NON_EMPTY_STRING,
      });
      ok = false;
    }
    if (flow !== undefined && node !== undefined) {
      instances[key] = {
        rel: instanceRel,
        flow,
        node,
        fields: raw.fields as InstanceSnapshot['fields'],
      };
    }
  }
  let collections: Record<string, string[]> | undefined;
  if (detail.collections !== undefined) {
    if (!isRecord(detail.collections)) {
      issues.push({
        code: 'parse-error',
        path: 'seed.detail.collections',
        message: 'application bundle seed.detail.collections 必须是对象',
        expected: EXPECTED_OBJECT,
      });
      return undefined;
    }
    collections = {};
    for (const [name, members] of Object.entries(detail.collections)) {
      if (!Array.isArray(members) || members.some((member) => typeof member !== 'string')) {
        issues.push({
          code: 'parse-error',
          path: `seed.detail.collections.${name}`,
          message: `application bundle seed collection "${name}" 必须是字符串数组`,
          expected: EXPECTED_STRING_ARRAY,
        });
        ok = false;
        continue;
      }
      collections[name] = [...members] as string[];
    }
  }
  if (!ok || rel === undefined) return undefined;
  return { rel, detail: { instances, ...(collections !== undefined ? { collections } : {}) } };
}

/**
 * 元素区走查:逐元素调用子定义解析器(失败包装为携带原始错误的 issue,
 * message 与子解析器抛出文案逐字一致),再做区内 name 唯一性检查。
 */
function inspectNamedSection<T extends { name: string }>(
  rows: readonly unknown[],
  parse: (row: unknown) => T,
  section: 'applications' | 'capabilities' | 'flows',
  elementCode: string,
  issues: ApplicationBundleIssue[],
): T[] {
  const parsed: T[] = [];
  rows.forEach((row, index) => {
    try {
      parsed.push(parse(row));
    } catch (error) {
      issues.push({
        code: elementCode,
        path: `${section}[${index}]`,
        message: error instanceof Error ? error.message : String(error),
        expected: EXPECTED_OBJECT,
        cause: error,
      });
    }
  });
  const names = new Set<string>();
  for (const row of parsed) {
    if (names.has(row.name)) {
      issues.push({
        code: 'duplicate-name',
        path: section,
        message: `application bundle ${section} 存在重复 name "${row.name}"`,
        expected: { unique: 'name' },
      });
    }
    names.add(row.name);
  }
  return parsed;
}

/**
 * 全量走查:按原 parseApplicationBundle 的检查顺序收集结构化问题;零问题时
 * 返回规范化 ApplicationBundle。跨引用与入口可达性只在前面全部干净时执行
 * (与原 fail-fast 语义一致,避免对残缺输入做引用裁决)。
 */
export function inspectApplicationBundle(input: unknown): BundleInspection {
  const issues: ApplicationBundleIssue[] = [];
  if (!isRecord(input)) {
    issues.push({
      code: 'parse-error',
      path: '/',
      message: 'application bundle 必须是对象',
      expected: EXPECTED_OBJECT,
    });
    return { issues };
  }
  if (input.schema !== APPLICATION_BUNDLE_SCHEMA) {
    issues.push({
      code: 'parse-error',
      path: 'schema',
      message: `application bundle schema 必须是 ${APPLICATION_BUNDLE_SCHEMA}`,
      expected: APPLICATION_BUNDLE_SCHEMA,
    });
  }
  let bundleName: string | undefined;
  let bundleVersion: number | undefined;
  if (!isRecord(input.bundle)) {
    issues.push({
      code: 'parse-error',
      path: 'bundle',
      message: 'application bundle bundle 必须是对象',
      expected: EXPECTED_BUNDLE,
    });
  } else {
    if (typeof input.bundle.name === 'string' && input.bundle.name !== '') {
      bundleName = input.bundle.name;
    } else {
      issues.push({
        code: 'parse-error',
        path: 'bundle.name',
        message: 'application bundle bundle.name 必须是非空字符串',
        expected: EXPECTED_NON_EMPTY_STRING,
      });
    }
    const version = input.bundle.version;
    if (Number.isSafeInteger(version) && (version as number) >= 1) {
      bundleVersion = version as number;
    } else {
      issues.push({
        code: 'parse-error',
        path: 'bundle.version',
        message: 'application bundle bundle.version 必须是正整数',
        expected: EXPECTED_VERSION,
      });
    }
  }
  const arraysOk = ['applications', 'capabilities', 'flows'].every((key) =>
    Array.isArray(input[key]),
  );
  if (!arraysOk) {
    for (const key of ['applications', 'capabilities', 'flows'] as const) {
      if (!Array.isArray(input[key])) {
        issues.push({
          code: 'parse-error',
          path: key,
          message: 'application bundle applications/capabilities/flows 必须是数组',
          expected: EXPECTED_ARRAY,
        });
      }
    }
  }

  const applications = Array.isArray(input.applications)
    ? inspectNamedSection(
        input.applications,
        parseApplicationDefinition,
        'applications',
        'invalid-application',
        issues,
      )
    : [];
  const capabilities = Array.isArray(input.capabilities)
    ? inspectNamedSection(
        input.capabilities,
        parseCapabilityDefinition,
        'capabilities',
        'invalid-capability',
        issues,
      )
    : [];
  const flows = Array.isArray(input.flows)
    ? inspectNamedSection(input.flows, parseFlowDefinition, 'flows', 'invalid-flow', issues)
    : [];
  const seed = inspectSeed(input.seed, issues);

  if (issues.length === 0) {
    const applicationNames = new Set(applications.map((application) => application.name));
    const flowByName = new Map(flows.map((flow) => [flow.name, flow]));
    for (const flow of flows) {
      if (!applicationNames.has(flow.app ?? 'default')) {
        issues.push({
          code: 'unknown-reference',
          path: `flows.${flow.name}.app`,
          message: `application bundle flow "${flow.name}" 引用未知 application "${flow.app}"`,
        });
      }
    }
    for (const [rel, instance] of Object.entries(seed!.detail.instances)) {
      const flow = flowByName.get(instance.flow);
      if (flow === undefined) {
        issues.push({
          code: 'unknown-reference',
          path: `seed.instances.${rel}.flow`,
          message: `application bundle seed instance "${rel}" 引用未知 flow "${instance.flow}"`,
          expected: [...flowByName.keys()],
        });
      } else if (!flow.nodes.some((node) => node.name === instance.node)) {
        issues.push({
          code: 'unknown-reference',
          path: `seed.instances.${rel}.node`,
          message: `application bundle seed instance "${rel}" 的 node "${instance.node}" 不属于 flow "${instance.flow}"`,
          expected: flow.nodes.map((node) => node.name),
        });
      }
    }
    for (const [collection, members] of Object.entries(seed!.detail.collections ?? {})) {
      for (const member of members) {
        if (seed!.detail.instances[member] === undefined) {
          issues.push({
            code: 'unknown-reference',
            path: `seed.detail.collections.${collection}`,
            message: `application bundle seed collection "${collection}" 引用未知 instance "${member}"`,
          });
        }
      }
    }
    try {
      validateApplicationEntryReachability(applications, flows, seed!.detail.instances);
    } catch (error) {
      issues.push({
        code: 'entry-unreachable',
        path: 'applications.entry',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }
  }

  if (issues.length > 0) return { issues };
  return {
    issues,
    value: {
      schema: APPLICATION_BUNDLE_SCHEMA,
      bundle: { name: bundleName!, version: bundleVersion! },
      applications,
      capabilities,
      flows,
      seed: seed!,
    },
  };
}

/**
 * unknown 应用制品 → 规范化、跨引用完整的安装输入;非法时按首条问题原文抛出
 * (元素级/可达性失败重抛原始错误对象,保持错误类型;公共行为零变化,D69.3)。
 */
export function parseApplicationBundle(input: unknown): ApplicationBundle {
  const { issues, value } = inspectApplicationBundle(input);
  if (value === undefined) {
    throw issues[0]!.cause ?? new Error(issues[0]!.message);
  }
  return value;
}

/** 结构化拒绝伴生通道:剥离内部 cause 后的全部问题,供 Draft 校验透传。 */
export function applicationBundleIssues(input: unknown): ApplicationBundleIssue[] {
  return inspectApplicationBundle(input).issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
  }));
}
