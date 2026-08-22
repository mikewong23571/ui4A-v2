/**
 * agent 循环协议(arch-brief §6:「循环是协议,driver 是插件」)。
 *
 * 每步:取当前实体 → driver.decide → 执行操作:
 * - navigate:立即取目标实体,成功则切换当前 rel;404 记 not-found 并回流;
 * - exec:POST /api/exec;2xx 记 executed 并入 successes;4xx/网络故障记 rejected 并回流;
 * - done / fail:终止。
 * 终止:done、fail、机械停滞、maxSteps、起始实体不可得。
 * 拒绝即数据(I6):lastRejection 只影响紧接着的下一步(消费即清)。
 * 循环零智能:不解释拒绝、不判断完成——决策全在 driver。
 */
import { createContractClient } from './http';
import type {
  AgentDriver,
  AgentGoal,
  AgentRunResult,
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

export async function runAgent(
  driver: AgentDriver,
  goal: AgentGoal,
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  const client = createContractClient(options.baseUrl, options.fetchImpl);
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
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
      sitemap = {
        version: fetched.version,
        surfaces: fetched.surfaces.map((surface) => ({
          rel: surface.rel,
          title: surface.title,
        })),
        applications: fetched.applications,
      };
    }
  } catch {
    sitemap = undefined;
  }

  let currentRel = options.startRel ?? DEFAULT_START_REL;
  const trail: TrailStep[] = [];
  const successes: ExecSuccess[] = [];
  let lastRejection: RejectionRecord | undefined;
  // 同一合同处境第三次出现且期间没有成功 exec，说明 driver 正在机械绕圈。
  // 循环不猜业务完成条件，只对完全相同的可观察状态做协议级有限性保护。
  const stateVisits = new Map<string, number>();

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
    const context: DriverContext = {
      goal,
      currentRel,
      entity: fetched.entity,
      trail: [...trail],
      successes: [...successes],
      lastRejection,
      sitemap,
      role: options.role,
      app: options.app,
    };
    lastRejection = undefined;
    const op = await driver.decide(context, decideSink);

    if (op.kind === 'done') {
      pushStep({ step, rel: currentRel, op, outcome: 'done' });
      return { goal, outcome: 'done', summary: op.summary, steps: trail, successes };
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
