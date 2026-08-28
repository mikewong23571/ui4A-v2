/**
 * 画布 action 拦截门(T7 Phase B / spec 架构决定 3b)。
 *
 * A2UI 组件事件(surface.dispatchAction → MessageProcessor actionHandler)
 * 一律经本门映射:事件上下文携带目标 rel + 动作名,**只有实体当前声明
 * 的动作**才转发 /api/exec(renderer 固定身份);白名单外(未声明动作/
 * 未注册实体/缺 rel)就地拒绝且零网络调用——合同外按钮无法提交
 * (I3 的运行时面)。exec 被裁决层拒绝时如实回流 layer/reason。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { ExecClientResult } from '../../components/exec-client';

/** A2UI 客户端动作(SDK 合同形状;上下文由组件声明)。 */
export interface CanvasClientAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

/** 提交函数形态(缺省业务 /api/exec;测试注入)。 */
export type GateExecFn = (input: {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}) => Promise<ExecClientResult>;

/** 拦截结果:executed(已提交)/ refused(裁决层拒)/ rejected(白名单外)。 */
export type GateOutcome =
  | { outcome: 'executed'; entity: SirenEntity; subject?: SirenEntity }
  | { outcome: 'refused'; status: number; layer: string; reason: string }
  | { outcome: 'rejected'; reason: string };

export interface ActionGate {
  /** 注册实体的已声明动作(渲染 spec 解引用到的实体;白名单数据源)。 */
  register(entity: SirenEntity): void;
  /** 清空白名单(surface 重规划时重建)。 */
  clear(): void;
  /** MessageProcessor actionHandler:组件事件 → 白名单裁决 → /api/exec。 */
  handle(action: CanvasClientAction): Promise<GateOutcome>;
}

/** 动作上下文的 params(可选;仅接受对象形状,其余忽略)。 */
function paramsOf(context: Record<string, unknown>): Record<string, unknown> | undefined {
  const params = context.params;
  return typeof params === 'object' && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : undefined;
}

export function createActionGate(execFn: GateExecFn): ActionGate {
  // rel → 该实体当前声明的动作名集合(实体快照即真相)。
  const declared = new Map<string, Set<string>>();

  return {
    register(entity) {
      const rel = entity.properties.rel;
      if (typeof rel !== 'string' || rel === '') return;
      declared.set(rel, new Set(entity.actions.map((action) => action.name)));
    },
    clear() {
      declared.clear();
    },
    async handle(action) {
      const rel = action.context.rel;
      if (typeof rel !== 'string' || rel === '') {
        return {
          outcome: 'rejected',
          reason: `动作 "${action.name}" 缺目标实体上下文(rel)——渲染层拒绝,零 /api/exec 调用`,
        };
      }
      const allowed = declared.get(rel);
      if (allowed === undefined || !allowed.has(action.name)) {
        const known =
          allowed === undefined
            ? '实体未注册(不在任何渲染 surface 的数据模型内)'
            : `该实体声明的动作是 [${[...allowed].join(', ')}]`;
        return {
          outcome: 'rejected',
          reason: `动作 "${action.name}" 不在实体 "${rel}" 的已声明动作内(${known})——渲染层拒绝,零 /api/exec 调用`,
        };
      }
      const result = await execFn({ rel, action: action.name, params: paramsOf(action.context) });
      if (result.ok) {
        return {
          outcome: 'executed',
          entity: result.entity,
          ...(result.subject !== undefined ? { subject: result.subject } : {}),
        };
      }
      return {
        outcome: 'refused',
        status: result.status,
        layer: result.layer,
        reason: result.reason,
      };
    },
  };
}
