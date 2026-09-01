/**
 * 激活不变式检查器(T4 Phase A Task 3;arch-brief §10 A.5 种子集;
 * T10 Phase A Task 3 增第七条 app-known,spec 架构决定 3;
 * T13 Phase D Task 1 增第八条 capability-registered,spec 架构决定 4;
 * T18 Phase E 增 executor-profile-valid)。
 *
 * validateDefinition(draft, registries) → checks:十项逐条、全量报告不短路
 * (与 guard 求值同口径:每项都要有结果,checks 入 activation 实体与
 * definition-submitted 事件 detail——"非法动作被拒绝、非法定义也应被拒绝"
 * 的定义层落点)。
 *
 * 十项:edge-targets-exist / guards-registered / field-types-known /
 * effect-known / initial-exists / terminal-reachable / app-known /
 * capability-registered / executor-profile-valid / submission-policy-valid。
 * 纯函数:只读草稿与注册表。
 */
import type {
  ActivationCheck,
  CapabilityDefinition,
  FlowDefinition,
  GuardRegistry,
} from '@ui4a/shared';
import { KNOWN_EFFECT_TYPES, KNOWN_FIELD_TYPES, reachableNodes, terminalNodes } from '@ui4a/shared';
import type { ActionDefinition, FieldDefinition, FieldType } from '../core/types';
import { parseCapabilityInputBinding } from '../execution/capability-input-binding';
import { validateSubmissionPolicy } from '../submission/policy';

/** 检查器依赖的注册表(meta/registries 的运行时子集)。 */
export interface DefinitionRegistries {
  /** 谓词注册表(guards-registered 按键集校验)。 */
  guards: GuardRegistry;
  /** 已知字段类型;缺省 KNOWN_FIELD_TYPES。 */
  fieldTypes?: ReadonlySet<FieldType>;
  /** 已知效果类型;缺省 KNOWN_EFFECT_TYPES。 */
  effectTypes?: ReadonlySet<string>;
  /**
   * 已激活 application 名集合(app-known 按键集校验;T10)。
   * 未提供 → app-known vacuous pass(过渡期语义:Phase B 的 boot seed/fold
   * 落表前运行时快照没有 application 定义,硬拒会误伤合法提交);
   * Phase B 后由 seed 保证 'default' 始终激活,本检查长牙。
   */
  applications?: ReadonlySet<string>;
  /**
   * 已注册 capability 名集合(capability-registered 按键集校验;T13)。
   * 未提供 → capability-registered vacuous pass(过渡期语义:Phase C 的
   * boot seed/fold 落表前运行时快照没有 capability 定义,硬拒会误伤合法
   * 提交);Phase C 后由 seed 保证被引用 capability(draft/notify/clarify)
   * 始终注册,本检查长牙。
   */
  capabilities?: ReadonlySet<string>;
  /** Capability definitions and configured executor profile classes (T18). */
  capabilityDefinitions?: Readonly<Record<string, CapabilityDefinition>>;
  executorProfiles?: ReadonlyMap<string, string>;
  /** Server-resolved Native Function handler availability; deployment details remain private. */
  nativeFunctionProfiles?: ReadonlyMap<
    string,
    { executorClass: string; handlerRef: string; available: boolean }
  >;
}

interface EffectLike {
  type: string;
  to?: unknown;
  capability?: unknown;
  bind?: unknown;
  'on-done'?: unknown;
  'on-error'?: unknown;
}

/** 动作的效果列表(单/缺省数组化,不规范化——校验看声明原样)。 */
function effectsOf(action: { effect?: unknown }): EffectLike[] {
  if (action.effect === undefined || action.effect === null) return [];
  const list = Array.isArray(action.effect) ? action.effect : [action.effect];
  return list.filter((e): e is EffectLike => typeof e === 'object' && e !== null);
}

/** 激活不变式检查器:返回十项检查结果(pass + 失败明细)。 */
export function validateDefinition(
  draft: FlowDefinition,
  registries: DefinitionRegistries,
): ActivationCheck[] {
  const fieldTypes = registries.fieldTypes ?? KNOWN_FIELD_TYPES;
  const effectTypes = registries.effectTypes ?? KNOWN_EFFECT_TYPES;
  const guardNames = new Set(Object.keys(registries.guards));
  const nodeNames = new Set(draft.nodes.map((node) => node.name));
  const actionsByName = new Map<string, ActionDefinition[]>();
  for (const node of draft.nodes) {
    for (const action of node.actions) {
      actionsByName.set(action.name, [...(actionsByName.get(action.name) ?? []), action]);
    }
  }

  const edgeIssues: string[] = [];
  const guardIssues: string[] = [];
  const fieldTypeIssues: string[] = [];
  const effectIssues: string[] = [];
  const capabilityIssues: string[] = [];
  const executorProfileIssues: string[] = [];
  const submissionIssues: string[] = [];

  const validateFunctionCallback = (
    actionName: unknown,
    kind: 'success' | 'failure',
    where: string,
  ): void => {
    if (typeof actionName !== 'string' || actionName === '') {
      executorProfileIssues.push(`${where}: ${kind} callback action is required`);
      return;
    }
    const candidates = actionsByName.get(actionName) ?? [];
    if (candidates.length !== 1) {
      executorProfileIssues.push(
        `${where}: callback action "${actionName}" must resolve exactly once`,
      );
      return;
    }
    const callback = candidates[0]!;
    if (callback.internal !== 'capability-callback') {
      executorProfileIssues.push(
        `${where}: callback action "${actionName}" must be internal capability ingress`,
      );
    }
    const expected =
      kind === 'success'
        ? { executionId: 'text', result: 'json', receipt: 'json' }
        : { executionId: 'text', failure: 'json' };
    const fields = new Map((callback.fields ?? []).map((field) => [field.name, field]));
    for (const [name, type] of Object.entries(expected)) {
      const field = fields.get(name);
      if (field === undefined || field.type !== type || field.persist !== false) {
        executorProfileIssues.push(
          `${where}: callback action "${actionName}" field ${name} must be ${type} persist:false`,
        );
      }
    }
  };

  if (draft.submission?.mode === 'none' && draft.nodes.some((node) => node.actions.length > 0)) {
    submissionIssues.push('flow submission none cannot expose write actions');
  }

  // capability-registered(T13 第八条)的引用点扫描,与 apps/web
  // capabilities.test.ts 静态保证同一扫描面:field source 为 proposal 时的
  // source.capability、field 的 on-invalid 澄清标记(类型是字面枚举
  // 'clarify',但定义是数据,枚举外取值由本检查兜底)、effect spawn 的
  // capability。elicit.strategy 是引出策略名,不是 capability 引用。
  // registries.capabilities 未提供时 vacuous pass(过渡期),不扫描。
  const capabilities = registries.capabilities;
  const visitFieldCapabilities = (field: FieldDefinition, where: string): void => {
    if (capabilities === undefined) return;
    if (field.source?.kind === 'proposal' && field.source.capability !== undefined) {
      if (!capabilities.has(field.source.capability)) {
        capabilityIssues.push(
          `${where}.source: proposal 引用的 capability "${field.source.capability}" 未注册`,
        );
      }
    }
    if (field['on-invalid'] !== undefined && !capabilities.has(field['on-invalid'])) {
      capabilityIssues.push(
        `${where}.on-invalid: 澄清标记引用的 capability "${field['on-invalid']}" 未注册`,
      );
    }
  };

  // 流级字段。
  for (const field of draft.fields ?? []) {
    if (!fieldTypes.has(field.type)) {
      fieldTypeIssues.push(`fields[${field.name}]: 未知字段类型 "${String(field.type)}"`);
    }
    visitFieldCapabilities(field, `fields[${field.name}]`);
  }

  for (const node of draft.nodes) {
    for (const field of node.fields ?? []) {
      if (!fieldTypes.has(field.type)) {
        fieldTypeIssues.push(
          `nodes[${node.name}].fields[${field.name}]: 未知字段类型 "${String(field.type)}"`,
        );
      }
      visitFieldCapabilities(field, `nodes[${node.name}].fields[${field.name}]`);
    }
    for (const action of node.actions) {
      const where = `nodes[${node.name}].actions[${action.name}]`;
      if (action.submission?.mode === 'none') {
        submissionIssues.push(`${where}.submission: none action cannot be exposed`);
      }
      if (action.submission !== undefined) {
        submissionIssues.push(
          ...validateSubmissionPolicy(action.submission, {
            declaredAction: true,
            hasSchema: true,
            hasAuthorization: true,
            risk: action['requires-confirmation'] ?? 'low',
          }).map((issue) => `${where}.submission: ${issue}`),
        );
      }
      // 边目标:action.to 与 transition 效果的 to 都必须落在节点集。
      if (action.to !== undefined && !nodeNames.has(action.to)) {
        edgeIssues.push(`${where}.to: 目标节点 "${action.to}" 不存在`);
      }
      for (const field of action.fields ?? []) {
        if (!fieldTypes.has(field.type)) {
          fieldTypeIssues.push(
            `${where}.fields[${field.name}]: 未知字段类型 "${String(field.type)}"`,
          );
        }
        visitFieldCapabilities(field, `${where}.fields[${field.name}]`);
      }
      for (const guard of action.guards ?? []) {
        if (!guardNames.has(guard)) {
          guardIssues.push(`${where}.guards: 谓词 "${guard}" 未注册`);
        }
      }
      const effects = effectsOf(action);
      if (effects.length === 0 && action.to === undefined) {
        // 无效果的空动作合法(纯声明);无检查项。
      }
      for (const effect of effects) {
        if (!effectTypes.has(effect.type)) {
          effectIssues.push(`${where}.effect: 未知效果类型 "${String(effect.type)}"`);
          continue;
        }
        if (effect.type === 'transition') {
          const target = (effect.to ?? action.to) as string | undefined;
          if (target === undefined) {
            edgeIssues.push(`${where}.effect: transition 缺少目标`);
          } else if (!nodeNames.has(target)) {
            edgeIssues.push(`${where}.effect: 目标节点 "${target}" 不存在`);
          }
        }
        if (
          effect.type === 'spawn' &&
          typeof effect.capability === 'string' &&
          capabilities !== undefined &&
          !capabilities.has(effect.capability)
        ) {
          capabilityIssues.push(
            `${where}.effect: spawn 引用的 capability "${effect.capability}" 未注册`,
          );
        }
        if (
          effect.type === 'spawn' &&
          typeof effect.capability === 'string' &&
          registries.capabilityDefinitions !== undefined &&
          registries.executorProfiles !== undefined
        ) {
          const requirement = registries.capabilityDefinitions[effect.capability]?.executor;
          if (requirement !== undefined) {
            const configuredClass = registries.executorProfiles.get(requirement.profile);
            if (configuredClass === undefined) {
              executorProfileIssues.push(
                `${where}.effect: executor profile "${requirement.profile}" 未配置`,
              );
            } else if (configuredClass !== requirement.class) {
              executorProfileIssues.push(
                `${where}.effect: executor profile "${requirement.profile}" class 应为 "${requirement.class}"，实际为 "${configuredClass}"`,
              );
            }
            const capability = registries.capabilityDefinitions[effect.capability];
            if (requirement.class === 'native-function') {
              if (requirement.agentDefinition !== undefined) {
                executorProfileIssues.push(
                  `${where}.effect: Native Function executor must not declare an Agent Definition`,
                );
              }
              if (capability?.inputSchema === undefined || capability.outputSchema === undefined) {
                executorProfileIssues.push(
                  `${where}.effect: Native Function capability requires input/output schemas`,
                );
              }
              try {
                parseCapabilityInputBinding(effect.bind);
              } catch (error) {
                executorProfileIssues.push(
                  `${where}.effect: invalid Native Function binding: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              }
              const deployed = registries.nativeFunctionProfiles?.get(requirement.profile);
              if (
                deployed === undefined ||
                deployed.executorClass !== requirement.class ||
                !deployed.available
              ) {
                executorProfileIssues.push(
                  `${where}.effect: Native Function profile "${requirement.profile}" handler is unavailable`,
                );
              }
              validateFunctionCallback(effect['on-done'], 'success', `${where}.effect`);
              validateFunctionCallback(effect['on-error'], 'failure', `${where}.effect`);
            } else if (requirement.agentDefinition === undefined) {
              executorProfileIssues.push(
                `${where}.effect: Agent executor requires an exact Agent Definition`,
              );
            }
          }
        }
      }
    }
  }

  const initialExists = nodeNames.has(draft.initial);
  const initialIssues = initialExists ? undefined : [`initial "${draft.initial}" 不在节点集`];

  const terminals = terminalNodes(draft);
  const reachable = reachableNodes(draft);
  const reachableTerminals = terminals.filter((name) => reachable.has(name));
  const terminalIssues =
    terminals.length === 0
      ? ['流程没有任何 terminal 节点(无出边节点)']
      : reachableTerminals.length === 0
        ? [`terminal(${terminals.join(', ')})均不可从 initial "${draft.initial}" 到达`]
        : undefined;

  // app-known(T10 第七条):归一化后的 draft.app(缺省 → 'default',与
  // parse 归一化同口径;显式空串属非法引用,parse 不拒、由本检查兜底)
  // 必须指向已激活 application。registries.applications 未提供时 vacuous
  // pass(过渡期;落点注释见 DefinitionRegistries.applications)。
  const appIssues: string[] = [];
  if (registries.applications !== undefined) {
    const app = draft.app ?? 'default';
    if (app === '') {
      appIssues.push('app: 显式空串不是合法的 application 引用');
    } else if (!registries.applications.has(app)) {
      appIssues.push(`app: "${app}" 不是已激活的 application`);
    }
  }

  return [
    {
      name: 'edge-targets-exist',
      pass: edgeIssues.length === 0,
      ...(edgeIssues.length > 0 ? { detail: edgeIssues } : {}),
    },
    {
      name: 'guards-registered',
      pass: guardIssues.length === 0,
      ...(guardIssues.length > 0 ? { detail: guardIssues } : {}),
    },
    {
      name: 'field-types-known',
      pass: fieldTypeIssues.length === 0,
      ...(fieldTypeIssues.length > 0 ? { detail: fieldTypeIssues } : {}),
    },
    {
      name: 'effect-known',
      pass: effectIssues.length === 0,
      ...(effectIssues.length > 0 ? { detail: effectIssues } : {}),
    },
    {
      name: 'initial-exists',
      pass: initialExists,
      ...(initialIssues !== undefined ? { detail: initialIssues } : {}),
    },
    {
      name: 'terminal-reachable',
      pass: terminalIssues === undefined,
      ...(terminalIssues !== undefined ? { detail: terminalIssues } : {}),
    },
    {
      name: 'app-known',
      pass: appIssues.length === 0,
      ...(appIssues.length > 0 ? { detail: appIssues } : {}),
    },
    {
      name: 'capability-registered',
      pass: capabilityIssues.length === 0,
      ...(capabilityIssues.length > 0 ? { detail: capabilityIssues } : {}),
    },
    {
      name: 'executor-profile-valid',
      pass: executorProfileIssues.length === 0,
      ...(executorProfileIssues.length > 0 ? { detail: executorProfileIssues } : {}),
    },
    {
      name: 'submission-policy-valid',
      pass: submissionIssues.length === 0,
      ...(submissionIssues.length > 0 ? { detail: submissionIssues } : {}),
    },
  ];
}
