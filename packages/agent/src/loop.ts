/**
 * agent 循环协议(arch-brief §6:「循环是协议,driver 是插件」)。
 *
 * 每步:取当前实体 → driver.decide → 执行操作:
 * - navigate:立即取目标实体,成功则切换当前 rel;404 记 not-found 并回流;
 * - exec:POST /api/exec;2xx 记 executed 并入 successes;4xx/网络故障记 rejected 并回流;
 * - done / fail:终止。
 * 终止:done、fail、maxSteps、起始实体不可得。
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
      };
    }
  } catch {
    sitemap = undefined;
  }

  let currentRel = options.startRel ?? DEFAULT_START_REL;
  const trail: TrailStep[] = [];
  const successes: ExecSuccess[] = [];
  let lastRejection: RejectionRecord | undefined;

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
    };
    lastRejection = undefined;
    const op = await driver.decide(context);

    if (op.kind === 'done') {
      trail.push({ step, rel: currentRel, op, outcome: 'done' });
      return { goal, outcome: 'done', summary: op.summary, steps: trail, successes };
    }
    if (op.kind === 'fail') {
      trail.push({ step, rel: currentRel, op, outcome: 'failed' });
      return { goal, outcome: 'failed', summary: op.reason, steps: trail, successes };
    }

    if (op.kind === 'navigate') {
      const target = await client.getEntity(op.rel);
      if (target.entity !== undefined) {
        currentRel = op.rel;
        trail.push({
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
        trail.push({ step, rel: currentRel, op, outcome: 'not-found', rejection });
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
      trail.push({
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
      trail.push({ step, rel: currentRel, op, outcome: 'rejected', rejection });
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
