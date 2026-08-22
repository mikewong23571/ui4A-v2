/**
 * agent 循环协议(arch-brief §6:「循环是协议,driver 是插件」)。
 *
 * 每步:取当前实体 → driver.decide → 执行操作:
 * - answer:直接返回基于授权观察的临时回答，零 HTTP 写入;
 * - clarify:返回待澄清问题与原目标延续，终止本次 run 且零 HTTP 写入;
 * - navigate:立即取目标实体,成功则切换当前 rel;404 记 not-found 并回流;
 * - exec:POST /api/exec;200 记 executed 并入 successes;202 记 suspended 并终止等待人类;
 *   4xx/网络故障记 rejected 并回流;
 * - done / fail:终止。
 * 终止:done、fail、机械停滞、maxSteps、起始实体不可得。
 * 拒绝即数据(I6):lastRejection 只影响紧接着的下一步(消费即清)。
 * 循环零智能:不解释拒绝、不判断完成——决策全在 driver。
 */
import { createContractClient } from './http';
import { authorizeEffects, type ProposedEffect } from './authorization';
import type {
  AgentDriver,
  AgentGoal,
  AgentOperation,
  AgentRunResult,
  ConversationContext,
  ContractObservation,
  DriverContext,
  EntitySummary,
  ExecSuccess,
  RejectionRecord,
  RunAgentOptions,
  SitemapSummary,
  TrailStep,
} from './types';
import type { SirenEntity } from '@ui4a/engine';

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_MAX_OBSERVATIONS = 8;
const DEFAULT_MAX_CONVERSATION_MESSAGES = 12;
const DEFAULT_START_REL = 'articles';
const DEFAULT_CHANNEL = 'http';

/** Siren 实体 → 轨迹摘要(rel/class/node/count/动作清单)。 */
export function summarizeEntity(entity: SirenEntity): EntitySummary {
  const properties = entity.properties;
  const node = properties.node;
  const count = properties.count;
  return {
    rel: typeof properties.rel === 'string' ? properties.rel : '',
    class: [...entity.class],
    ...(typeof node === 'string' ? { node } : {}),
    ...(typeof count === 'number' ? { count } : {}),
    actions: entity.actions.map((action) => action.name),
  };
}

function copyGoal(goal: AgentGoal): AgentGoal {
  return {
    ...goal,
    ...(goal.fields !== undefined ? { fields: { ...goal.fields } } : {}),
  };
}

/** 防止 driver 通过可变引用改写上层的会话投影。 */
function copyConversation(
  context: ConversationContext | undefined,
): ConversationContext | undefined {
  if (context === undefined) return undefined;
  return {
    ...(context.activeGoal !== undefined
      ? { activeGoal: context.activeGoal === null ? null : copyGoal(context.activeGoal) }
      : {}),
    ...(context.focus !== undefined
      ? {
          focus:
            context.focus === null
              ? null
              : {
                  ...context.focus,
                  ...(context.focus.history !== undefined
                    ? { history: context.focus.history.map((entry) => ({ ...entry })) }
                    : {}),
                },
        }
      : {}),
    ...(context.referents !== undefined
      ? { referents: context.referents.map((referent) => ({ ...referent })) }
      : {}),
    ...(context.constraints !== undefined
      ? { constraints: context.constraints.map((constraint) => ({ ...constraint })) }
      : {}),
    ...(context.authorizedEffects !== undefined
      ? {
          authorizedEffects: context.authorizedEffects.map((authorization) => ({
            ...authorization,
          })),
        }
      : {}),
    ...(context.pendingClarification !== undefined
      ? {
          pendingClarification:
            context.pendingClarification === null
              ? null
              : {
                  question: context.pendingClarification.question,
                  continuation: copyGoal(context.pendingClarification.continuation),
                  sourceMessageIds: [...context.pendingClarification.sourceMessageIds],
                },
        }
      : {}),
  };
}

export async function runAgent(
  driver: AgentDriver,
  goal: AgentGoal,
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  const client = createContractClient(options.baseUrl, options.fetchImpl);
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxObservations = Math.max(1, options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS);
  const requestedConversationLimit =
    options.maxConversationMessages ?? DEFAULT_MAX_CONVERSATION_MESSAGES;
  const maxConversationMessages = Number.isFinite(requestedConversationLimit)
    ? Math.max(0, Math.floor(requestedConversationLimit))
    : DEFAULT_MAX_CONVERSATION_MESSAGES;
  const providedConversationMessages = options.conversationMessages ?? [];
  const conversationMessages = (
    maxConversationMessages === 0
      ? []
      : providedConversationMessages.slice(-maxConversationMessages)
  ).map((message) => ({ ...message }));
  const conversation = copyConversation(options.conversation);
  const actor = options.actor ?? 'agent';
  const channel = options.channel ?? DEFAULT_CHANNEL;

  // sitemap 是版本级缓存结构的最外层,架构规定它是 agent 的静态上下文(取一次,
  // 全程复用);拿不到不致命——driver 退化为仅用实体导航。
  // T10:投影保留两层发现结构——扁平 surfaces(向后兼容)+ applications 分组
  //(name/intent/组内 flows 摘要;选 app〔读 intent〕→ 选 flow)。
  let sitemap: SitemapSummary | undefined;
  try {
    const fetched = await client.getSitemap();
    if (fetched !== undefined) {
      const full: SitemapSummary = {
        version: fetched.version,
        surfaces: fetched.surfaces.map((surface) => ({ ...surface })),
        applications: fetched.applications,
        capabilities: fetched.capabilities ?? [],
      };
      sitemap = full;
    }
  } catch {
    sitemap = undefined;
  }

  let currentRel = options.startRel ?? DEFAULT_START_REL;
  const trail: TrailStep[] = [];
  const successes: ExecSuccess[] = [];
  const observations: ContractObservation[] = [];
  let lastRejection: RejectionRecord | undefined;
  // 同一合同处境第三次出现且期间没有成功 exec，说明 driver 正在机械绕圈。
  // 循环不猜业务完成条件，只对完全相同的可观察状态做协议级有限性保护。
  const stateVisits = new Map<string, number>();

  /** effect gate 拒绝是协议数据：记轨迹、回流 driver，但绝不触发 POST。 */
  const authorize = (
    op: Extract<AgentOperation, { kind: 'exec' | 'exec-plan' }>,
    effects: ProposedEffect[],
  ): RejectionRecord | undefined => {
    if (options.requireEffectAuthorization !== true) return undefined;
    const result = authorizeEffects({
      authorization: op.authorization,
      effects,
      messages: conversationMessages,
      conversation,
    });
    if (result.ok) return undefined;
    return {
      rel: effects.length === 1 ? effects[0]!.rel : currentRel,
      action: op.kind === 'exec' ? op.action : 'exec-plan',
      layer: 'effect-authorization',
      reason: `effect 授权拒绝: ${result.reason}`,
      detail: { code: result.code },
    };
  };

  /** 最新快照替换同 rel 的旧观察，并把账本裁成有界的最近不同实体集合。 */
  const observe = (entity: SirenEntity): void => {
    const rel = typeof entity.properties.rel === 'string' ? entity.properties.rel : '';
    const prior = observations.findIndex((entry) => entry.rel === rel);
    if (prior >= 0) observations.splice(prior, 1);
    observations.push({ rel, entity });
    if (observations.length > maxObservations) {
      observations.splice(0, observations.length - maxObservations);
    }
  };

  /** 追加轨迹并同步回调(T9 Phase B 流式轨迹;观测者异常吞掉,不污染循环)。 */
  const pushStep = (step: TrailStep): void => {
    trail.push(step);
    try {
      options.onStep?.(step);
    } catch {
      // onStep 是观测钩子(如 SSE 帧推送;客户端断开时 enqueue 会抛)——
      // 观测失败不得中断协议循环,服务端轨迹照常跑完留痕。
    }
  };

  // 推理自述观测通道(T11 Phase C):llm 步 decide 产出 reasoning 时由 driver
  // 回调一次(聚合整段);rule driver 零回调。异常吞掉口径同 onStep。
  // 增量通道(onReasoningDelta)同構:两通道任一存在即构造 sink。
  const decideSink =
    options.onReasoning === undefined && options.onReasoningDelta === undefined
      ? undefined
      : {
          onReasoning: (text: string): void => {
            try {
              options.onReasoning?.(text);
            } catch {
              // 观测者不得污染协议循环(同 pushStep 口径)。
            }
          },
          onReasoningDelta: (piece: string): void => {
            try {
              options.onReasoningDelta?.(piece);
            } catch {
              // 同上:增量观测失败不拦截循环。
            }
          },
        };

  for (let step = 1; step <= maxSteps; step += 1) {
    const fetched = await client.getEntity(currentRel);
    if (fetched.entity === undefined) {
      return {
        goal,
        outcome: 'failed',
        summary: fetched.error ?? `实体 "${currentRel}" 不可得`,
        steps: trail,
        successes,
      };
    }
    observe(fetched.entity);

    const stateSignature = JSON.stringify({
      rel: currentRel,
      actions: fetched.entity.actions.map((action) => action.name).sort(),
      successes: successes.length,
      rejection:
        lastRejection === undefined
          ? null
          : {
              rel: lastRejection.rel,
              action: lastRejection.action ?? null,
              layer: lastRejection.layer ?? null,
            },
    });
    const visits = (stateVisits.get(stateSignature) ?? 0) + 1;
    stateVisits.set(stateSignature, visits);
    if (visits >= 3) {
      const evidence = [
        `重复处境:${currentRel}`,
        `可用动作:${fetched.entity.actions.map((action) => action.name).join(',') || '(无)'}`,
        `已成功执行:${successes.length}`,
      ];
      const op = {
        kind: 'fail' as const,
        reason: `检测到无进展导航循环；当前合同未暴露完成目标所需的可执行能力`,
        evidence,
      };
      pushStep({ step, rel: currentRel, op, outcome: 'failed' });
      return { goal, outcome: 'failed', summary: op.reason, steps: trail, successes };
    }

    // 上下文是逐步快照(trail/successes 拷贝):decide 之后循环继续追加,
    // 不应经由引用改写 driver 已见的历史。
    const entityFlow =
      typeof fetched.entity.properties.flow === 'string'
        ? fetched.entity.properties.flow
        : undefined;
    const currentApp =
      options.app ??
      sitemap?.applications.find((application) =>
        application.flows.some((flow) => flow.name === entityFlow),
      )?.name;
    const scopedSitemap =
      sitemap === undefined || currentApp === undefined
        ? sitemap
        : {
            ...sitemap,
            surfaces: sitemap.surfaces.filter(
              (surface) => surface.app === undefined || surface.app === currentApp,
            ),
            applications: sitemap.applications.filter(
              (application) => application.name === currentApp,
            ),
            capabilities: (sitemap.capabilities ?? []).filter((capability) =>
              capability.scope.applications.includes(currentApp),
            ),
          };
    const context: DriverContext = {
      goal,
      conversationMessages: conversationMessages.map((message) => ({ ...message })),
      conversation: copyConversation(conversation),
      currentRel,
      entity: fetched.entity,
      trail: [...trail],
      successes: [...successes],
      lastRejection,
      observations: [...observations],
      sitemap: scopedSitemap,
      role: options.role,
      app: currentApp,
    };
    lastRejection = undefined;
    const op = await driver.decide(context, decideSink);

    if (op.kind === 'done') {
      pushStep({ step, rel: currentRel, op, outcome: 'done' });
      return { goal, outcome: 'done', summary: op.summary, steps: trail, successes };
    }
    if (op.kind === 'answer') {
      pushStep({ step, rel: currentRel, op, outcome: 'answered' });
      if (op.continue === true) continue;
      return {
        goal,
        outcome: 'answered',
        summary: op.content,
        sources: op.sources,
        steps: trail,
        successes,
      };
    }
    if (op.kind === 'clarify') {
      pushStep({ step, rel: currentRel, op, outcome: 'clarification-needed' });
      return {
        goal,
        outcome: 'clarification-needed',
        summary: op.question,
        continuation: op.continuation,
        steps: trail,
        successes,
      };
    }
    if (op.kind === 'fail') {
      pushStep({ step, rel: currentRel, op, outcome: 'failed' });
      return { goal, outcome: 'failed', summary: op.reason, steps: trail, successes };
    }

    if (op.kind === 'navigate') {
      const target = await client.getEntity(op.rel);
      if (target.entity !== undefined) {
        currentRel = op.rel;
        pushStep({
          step,
          rel: op.rel,
          op,
          outcome: 'navigated',
          entity: summarizeEntity(target.entity),
        });
      } else {
        const rejection: RejectionRecord = {
          rel: op.rel,
          layer: 'not-found',
          reason: target.error ?? `实体 "${op.rel}" 不可达`,
        };
        lastRejection = rejection;
        pushStep({ step, rel: currentRel, op, outcome: 'not-found', rejection });
      }
      continue;
    }

    if (op.kind === 'exec-plan') {
      const effects = op.steps.map(({ rel, action }) => ({
        rel,
        action,
        entity: observations.find((observation) => observation.rel === rel)?.entity,
      }));
      const authorizationRejection = authorize(op, effects);
      if (authorizationRejection !== undefined) {
        lastRejection = authorizationRejection;
        pushStep({
          step,
          rel: currentRel,
          op,
          outcome: 'rejected',
          rejection: authorizationRejection,
        });
        continue;
      }
      const call = await client.execPlan({
        steps: op.steps,
        actor,
        principal: options.principal,
        channel,
      });
      if (call.outcome === 'completed') {
        successes.push(...op.steps.map(({ rel, action, params }) => ({ rel, action, params })));
        pushStep({ step, rel: currentRel, op, outcome: 'executed' });
        continue;
      }
      if (call.outcome === 'suspended') {
        const confirmationRel = call.confirmationRel ?? 'confirmation:(unknown)';
        const summary = `批量计划已挂起，等待人类在 ${confirmationRel} 确认`;
        pushStep({ step, rel: currentRel, op, outcome: 'suspended' });
        return { goal, outcome: 'suspended', summary, steps: trail, successes };
      }
      const rejection: RejectionRecord = {
        rel: currentRel,
        action: 'exec-plan',
        layer: 'plan',
        reason: call.reason ?? `exec-plan 被拒(HTTP ${call.status})`,
        ...(call.detail !== undefined ? { detail: call.detail } : {}),
      };
      lastRejection = rejection;
      pushStep({ step, rel: currentRel, op, outcome: 'rejected', rejection });
      continue;
    }

    const authorizationRejection = authorize(op, [
      { rel: currentRel, action: op.action, entity: fetched.entity },
    ]);
    if (authorizationRejection !== undefined) {
      lastRejection = authorizationRejection;
      pushStep({
        step,
        rel: currentRel,
        op,
        outcome: 'rejected',
        rejection: authorizationRejection,
      });
      continue;
    }

    const call = await client.exec({
      rel: currentRel,
      action: op.action,
      params: op.params ?? {},
      actor,
      principal: options.principal,
      channel,
    });
    if (call.ok) {
      successes.push({ rel: currentRel, action: op.action, params: op.params });
      pushStep({
        step,
        rel: currentRel,
        op,
        outcome: 'executed',
        ...(call.entity !== undefined ? { entity: summarizeEntity(call.entity) } : {}),
      });
    } else if (call.suspended === true) {
      const confirmationRel = call.confirmationRel ?? 'confirmation:(unknown)';
      const summary = `动作 ${op.action}(${currentRel}) 已挂起，等待人类在 ${confirmationRel} 确认`;
      pushStep({ step, rel: currentRel, op, outcome: 'suspended' });
      return { goal, outcome: 'suspended', summary, steps: trail, successes };
    } else {
      const rejection: RejectionRecord = {
        rel: currentRel,
        action: op.action,
        params: op.params,
        layer: call.layer,
        reason: call.reason ?? `exec 被拒(HTTP ${call.status})`,
        detail: call.detail,
      };
      lastRejection = rejection;
      pushStep({ step, rel: currentRel, op, outcome: 'rejected', rejection });
    }
  }

  return {
    goal,
    outcome: 'max-steps',
    summary: `达到步数上限 ${maxSteps} 未收到 done/fail`,
    steps: trail,
    successes,
  };
}
