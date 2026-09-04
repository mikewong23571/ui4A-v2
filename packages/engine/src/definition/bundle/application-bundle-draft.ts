/**
 * application-bundle Draft 纯校验器(T48 Phase 1 / T1.2)。
 *
 * 把安装边界的 parseApplicationBundle 适配为 Draft 校验合同:unknown payload →
 * {valid, issues, value};解析失败是 invalid + issues(拒绝是有理由的事件,
 * 不是异常),永不 throw。安装语义(planMetaBootstrap)属于激活阶段(T48
 * Phase 2),本模块只回答"这份制品是否是一份完整可安装的 bundle"。
 */
import type { DraftValidation } from '@ui4a/shared';

import { parseApplicationBundle, type ApplicationBundle } from '../meta-bootstrap';

export interface ApplicationBundleDraftValidation extends DraftValidation {
  value?: ApplicationBundle;
}

/** 当前已安装的 bundle 命名空间全集(由事件日志或其 fold 投影导出)。 */
export interface InstalledBundleNames {
  applications: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
  flows: ReadonlySet<string>;
}

/**
 * D66.1 fail-closed(T48 评审修复):受治理 genesis bundle 声明的**任何**名称
 * (application/capability/flow)若已在安装集合中,即为冲突——制品格式允许
 * 一个 bundle 声明多个 application,门禁必须校验全量清单而非仅 target 名,
 * 否则激活会按 bootstrap 幂等语义静默跳过已安装项,留下部分安装与失真的
 * receipt。返回冲突清单;全 fresh 返回 undefined。
 */
export function bundleInventoryConflicts(
  bundle: ApplicationBundle,
  installed: InstalledBundleNames,
): { applications: string[]; capabilities: string[]; flows: string[] } | undefined {
  const conflicts = {
    applications: bundle.applications
      .map((application) => application.name)
      .filter((name) => installed.applications.has(name)),
    capabilities: bundle.capabilities
      .map((capability) => capability.name)
      .filter((name) => installed.capabilities.has(name)),
    flows: bundle.flows
      .map((flow) => flow.name)
      .filter((name) => installed.flows.has(name)),
  };
  const total =
    conflicts.applications.length + conflicts.capabilities.length + conflicts.flows.length;
  return total === 0 ? undefined : conflicts;
}

/** Parse and validate an application bundle candidate without planning installation. */
export function validateApplicationBundleDraft(payload: unknown): ApplicationBundleDraftValidation {
  let value: ApplicationBundle;
  try {
    value = parseApplicationBundle(payload);
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          code: 'parse-error',
          path: '/',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  return { valid: true, issues: [], value };
}
