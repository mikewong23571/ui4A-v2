/**
 * application-bundle Draft 合同适配(T48 Phase 1 / T1.2–T1.4)。
 *
 * 引擎纯校验器(validateApplicationBundleDraft)之上的 Draft 级语义:
 * - target 合同:Draft target 必须等于解析出的 bundle 名;不匹配以
 *   target-name-mismatch issue 落进 Draft 校验(revise/validate 重算口径)。
 *   create 入口的授权 guard 拒绝见 create.ts,两处共用本模块的判定。
 * - 投影:inventory 级机械 diff(bundle 声明清单 vs 当前已安装,零 AI)与
 *   checks 汇总。激活(approve/安装事件规划)是 Phase 2,本模块不做。
 */
import {
  payloadFingerprint,
  validateApplicationBundleDraft,
  type ApplicationBundleDraftValidation,
  type FoldSnapshot,
} from '@ui4a/engine';
import type { ActivationCheck } from '@ui4a/shared';

import type { EngineRuntime } from '../service-outcome';

type EngineSnapshot = ReturnType<EngineRuntime['getSnapshot']>;

export interface BundleInventory {
  applications: string[];
  capabilities: string[];
  flows: string[];
}

export interface MechanicalApplicationBundleDiff {
  algorithm: 'bundle-inventory';
  bundle: { name: string; version: number };
  inventory: BundleInventory;
  added: BundleInventory;
  conflicts: BundleInventory;
  hash: string;
}

/** Parse + Draft target 合同;不匹配降为 issue(revise 仍可修正,不是 guard 拒绝)。 */
export function validateBundleCandidate(
  payload: unknown,
  target: string | undefined,
): ApplicationBundleDraftValidation {
  const validation = validateApplicationBundleDraft(payload);
  if (validation.value === undefined) return validation;
  const issues = [...validation.issues];
  if (validation.value.bundle.name !== target) {
    issues.push({
      code: 'target-name-mismatch',
      path: '/bundle/name',
      message: `bundle name ${validation.value.bundle.name} does not match target ${target ?? '(missing)'}`,
    });
  }
  return { ...validation, valid: validation.valid && issues.length === 0, issues };
}

export function applicationBundleInstalled(
  snapshot: EngineSnapshot,
  target: string | undefined,
): boolean {
  return target !== undefined && snapshot.applications?.[target] !== undefined;
}

/**
 * D71.5 应用名烧毁集的 deprecated 侧:target 命中 deprecatedApplications 审计
 * 表键。停用级联会删 applications 键,故与 applicationBundleInstalled(active
 * 侧)互为独立真相源;守卫面(create/validate)必须两侧都查——「尚未激活」
 * 是 checks 面(application-not-installed)的可视口径,「停用烧毁」是更强的
 * fail-closed 拒绝,两者语义不同,不共用谓词。
 *
 * 运行时快照是 fold 产物(FoldSnapshot,审计表在场时随行);EngineRuntime
 * 接口按 shared EngineSnapshot 收窄,读 deprecatedApplications 在此单点下探。
 */
export function applicationNameBurned(
  snapshot: EngineSnapshot,
  target: string | undefined,
): boolean {
  return (
    target !== undefined &&
    (snapshot as FoldSnapshot).deprecatedApplications?.[target] !== undefined
  );
}

/**
 * D71.5 应用名占用全集:taken = active(applications 键)∪ deprecated
 * (deprecatedApplications 审计表键)。全量清单冲突(bundleInventoryConflicts)
 * 的 applications 侧用本集——停用不释放名字,声明的次级 application 名命中
 * 任一侧即冲突。
 */
export function takenApplicationNames(snapshot: EngineSnapshot): Set<string> {
  return new Set([
    ...Object.keys(snapshot.applications ?? {}),
    ...Object.keys((snapshot as FoldSnapshot).deprecatedApplications ?? {}),
  ]);
}

function partition(
  names: readonly string[],
  installed: (name: string) => boolean,
): { added: string[]; conflicts: string[] } {
  const added: string[] = [];
  const conflicts: string[] = [];
  for (const name of names) (installed(name) ? conflicts : added).push(name);
  return { added, conflicts };
}

/** Bundle 声明清单 vs 当前已安装的 inventory 级机械 diff;无模型参与。 */
export function mechanicalBundleInventoryDiff(
  snapshot: EngineSnapshot,
  bundle: NonNullable<ApplicationBundleDraftValidation['value']>,
): MechanicalApplicationBundleDiff {
  const applications = partition(
    bundle.applications.map((application) => application.name),
    (name) => snapshot.applications?.[name] !== undefined,
  );
  const capabilities = partition(
    bundle.capabilities.map((capability) => capability.name),
    (name) => snapshot.capabilities?.[name] !== undefined,
  );
  const flows = partition(
    bundle.flows.map((flow) => flow.name),
    (name) => snapshot.definitions?.[name] !== undefined,
  );
  const diff = {
    algorithm: 'bundle-inventory' as const,
    bundle: { ...bundle.bundle },
    inventory: {
      applications: bundle.applications.map((application) => application.name),
      capabilities: bundle.capabilities.map((capability) => capability.name),
      flows: bundle.flows.map((flow) => flow.name),
    },
    added: {
      applications: applications.added,
      capabilities: capabilities.added,
      flows: flows.added,
    },
    conflicts: {
      applications: applications.conflicts,
      capabilities: capabilities.conflicts,
      flows: flows.conflicts,
    },
  };
  return { ...diff, hash: payloadFingerprint(diff) };
}

/**
 * Exact Draft 投影的 application-bundle 分支:checks 汇总 + 可解析时的机械 diff。
 *
 * G04b(T54 证据时点):checks 按投影时刻的**当前事实**求值。批准通过、应用安装
 * 完成后,`application-not-installed` 按当前事实为 false——这不是批准失败的
 * 证据(批准时依据以提交/接受事件为准),projection 为该时点歧义附注明细,
 * 不给历史补造 PASS,也不在 UI 层特判业务名。
 */
export function projectApplicationBundleDraft(
  snapshot: EngineSnapshot,
  target: string | undefined,
  payload: unknown,
): { diff?: MechanicalApplicationBundleDiff; checks: ActivationCheck[] } {
  const validation = validateApplicationBundleDraft(payload);
  const installedNow = applicationBundleInstalled(snapshot, target);
  const checks: ActivationCheck[] = [
    {
      name: 'bundle-parseable',
      pass: validation.valid,
      ...(validation.valid ? {} : { detail: validation.issues.map((issue) => issue.message) }),
    },
    {
      name: 'target-name-match',
      pass: validation.value !== undefined && validation.value.bundle.name === target,
    },
    {
      name: 'application-not-installed',
      pass: !installedNow,
      ...(installedNow
        ? {
            detail: [
              '应用现已安装:这是批准后的当前事实,不是批准失败;批准时依据以提交/接受事件为准',
            ],
          }
        : {}),
    },
  ];
  if (validation.value === undefined) return { checks };
  return { diff: mechanicalBundleInventoryDiff(snapshot, validation.value), checks };
}
