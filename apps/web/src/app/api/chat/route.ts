import {
  createDriver,
  renderSpecFor,
  resolveDriverKind,
  runAgent,
  type AgentGoal,
} from '@ui4a/agent';

import type { ChatTurnDetail } from '../../../chat/history';
import { wrapDriverForAudit, type AgentDecisionDetail } from '../../../chat/decisions';
import { resolveStartRel } from '../../../chat/start';
import { stepToMessage, trailToMessages } from '../../../chat/trail';
import { appendEvent } from '../../../db/events';
import { getDb, getEngine } from '../../../engine/service';
import { dispatchDelegation } from '../../../temporal/delegation';
import type { RenderSpec } from '../../../render/spec';
import { validateSpec } from '../../../render/validator';

// POST /api/chat — 悬浮聊天的合同后端(spec FR6/FR7,arch-brief §8)。
// - 请求 {goal: {verb, targetRel?, resource?, fields?}, sessionId?, driver?,
//   mode?: 'inline'|'delegated'};mode 缺省 inline(既有行为与测试零改动);
// - render capability(T7 Phase C / S5):展示类意图(按分类展示文章)先于
//   inline/delegated 分派短路——renderSpecFor(rule 确定路径)产零字面 spec →
//   零字面校验 → freezeSpec(首冻事件留痕,同 concern 复用首冻)→ 响应携带
//   render 载荷(spec + 画布入口);零 /api/exec(渲染不是执行,不走循环);
//   意图未命中/引擎不可达 → 原路交回 agent 循环(诚实失败口径不变);
// - inline(T9 Phase B 起为 SSE 流式,text/event-stream):服务端组装 driver
//   (rule | llm | auto——auto 无 key 回退 rule,I1 机械层),runAgent 循环过本源
//   HTTP 合同(actor=agent,principal=user:<sessionId>,channel=chat)——
//   "agent 走合同"字面成立;onStep 每步推一帧
//   {type:'step', message:{role:'assistant',text}, rel}(text 为 trail.ts
//   stepToMessage 口径),结束推 {type:'final', payload:{sessionId, driver,
//   requestedDriver, outcome, summary, steps, successes}};异常兜底
//   {type:'error', error};客户端断开仅中断推帧,循环照常跑完(留痕);
// - 聊天历史(T9 Phase B):inline 回合完成(含 failed/max-steps)后直写一条
//   chat-turn 事件(rel=chat:<sessionId>,detail 含 goal/outcome/summary/
//   messages/steps/driver——T11 Phase B 起 steps 为结构化 TrailStep[] 原料)
//   ——与 worker 同一双写者模式;engine fold 忽略该 kind
//   (纯审计留痕);落库失败 console.error 不阻断响应。GET /api/chat/history
//   按 sessionId 投影回合序列(服务端零会话态);
// - 决策审计(T11 Phase B / 架构决定 3):inline 路径每步决策直写一条
//   agent-decision 事件(rel/actor/principal/channel 与 chat-turn 同源同值,
//   detail 五要素 step/driver/prompt/reasoning/op——llm 的 prompt 为 system/user
//   全量原文、reasoning 暂恒 null;rule 的 prompt 为决策输入结构化摘要),
//   先于 chat-turn 落库;engine fold 忽略该 kind(纯留痕,I5 重放 hash 不变),
//   落库失败 console.error 不阻断响应(同 chat-turn 口径);delegated/render
//   短路回合不写(轨迹分别在舰队页/凝固事件,口径同 chat-turn);
// - delegated(T5 Phase B / spec 架构决定 5):校验 goal → 解析 startRel 与
//   driverKind(auto 先解析)→ dispatchDelegation 派发 delegationWorkflow
//   (taskQueue ui4a;baseUrl=自身 origin,worker activity 回环走本源合同)→
//   响应 {mode:'delegated', delegationId, statusUrl};派发失败(Temporal 不可达)
//   据实 503——委托没派出去不能假装成功;
// - 起始 rel 由 sitemap 词级交集解析(客户端行为),缺省 articles;
// - render 短路/参数错误/delegated 仍为一次性 JSON(响应形状不动);
//   B4:LLM 失败(401 等)如实进入 step 帧文本与 final.summary,route 不 5xx。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。

export const dynamic = 'force-dynamic';

interface ParsedChatBody {
  ok: true;
  goal: AgentGoal;
  sessionId: string;
  driver: 'rule' | 'llm' | 'auto';
  mode: 'inline' | 'delegated';
}

interface ParseError {
  ok: false;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): ParsedChatBody | ParseError {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const { goal, sessionId, driver, mode } = body;
  if (!isPlainObject(goal) || typeof goal.verb !== 'string' || goal.verb === '') {
    return { ok: false, error: 'goal 必须是 {verb: 非空字符串, …}' };
  }
  for (const key of ['targetRel', 'resource'] as const) {
    if (goal[key] !== undefined && typeof goal[key] !== 'string') {
      return { ok: false, error: `goal.${key} 必须是字符串` };
    }
  }
  if (goal.fields !== undefined && !isPlainObject(goal.fields)) {
    return { ok: false, error: 'goal.fields 必须是对象' };
  }
  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId 必须是字符串' };
  }
  if (driver !== undefined && driver !== 'rule' && driver !== 'llm' && driver !== 'auto') {
    return { ok: false, error: 'driver 必须是 "rule" | "llm" | "auto"' };
  }
  if (mode !== undefined && mode !== 'inline' && mode !== 'delegated') {
    return { ok: false, error: 'mode 必须是 "inline" | "delegated"' };
  }
  return {
    ok: true,
    // 双重断言理由:goal 的 verb/targetRel/resource/fields 各键已在上文逐键校验,
    // Record<string,unknown> 与 AgentGoal 结构不重叠是 TS 的保守判断,运行时形状已收敛。
    goal: goal as unknown as AgentGoal,
    sessionId: sessionId ?? crypto.randomUUID(),
    driver: driver ?? 'auto',
    mode: mode ?? 'inline',
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const { goal, sessionId, driver: requested, mode } = parsed;
  // baseUrl 口径(终审 M-2):delegated 派发的 workflow args.baseUrl 不信任
  // 请求 Host 头(可被调用方控制,进 workflow 会让 worker 以服务端身份持续
  // 回环抓取任意 origin)。APP_ORIGIN 显式覆盖;否则仅放行本机 Host(dev/
  // e2e 都在 localhost),非本机且未配置 → 拒绝 delegated 派发。
  const requestUrl = new URL(request.url);
  const resolved = resolveDriverKind(requested);
  let baseUrl: string;
  if (mode !== 'delegated') {
    baseUrl = requestUrl.origin;
  } else if (process.env.APP_ORIGIN !== undefined) {
    baseUrl = process.env.APP_ORIGIN;
  } else if (
    requestUrl.hostname === 'localhost' ||
    requestUrl.hostname === '127.0.0.1' ||
    requestUrl.hostname === '[::1]'
  ) {
    baseUrl = requestUrl.origin;
  } else {
    return Response.json(
      { error: 'delegated 派发要求配置 APP_ORIGIN(当前 Host 非本机,拒绝以不可信 origin 派发委托)' },
      { status: 400 },
    );
  }

  // render capability(T7 Phase C / S5):展示类意图 → spec 生成 + 凝固。
  // 先于 inline/delegated 分派:渲染说明不是委托任务,也不进执行循环。
  // 引擎不可达/意图未命中 → 原路交回下方既分派(诚实失败口径不变)。
  try {
    const engine = await getEngine(getDb());
    const generated = renderSpecFor(goal.verb, engine.getSitemap(), engine.listFrozenSpecs());
    if (generated !== undefined) {
      const validation = validateSpec(generated);
      if (!validation.valid) {
        // 生成器产出非法 spec 属内部缺陷:如实失败,不落日志不渲染(零字面入口把关)。
        const summary = validation.errors
          .map((error) => `${error.path}: ${error.message}`)
          .join('; ');
        return Response.json({
          sessionId,
          driver: resolved,
          requestedDriver: requested,
          outcome: 'failed',
          summary: `生成的渲染说明未过零字面校验: ${summary}`,
          messages: [{ role: 'assistant', text: `失败: 生成的渲染说明未过零字面校验: ${summary}` }],
          steps: [],
          successes: [],
        });
      }
      // 断言理由:validateSpec 已确认形状(引用节点 + 结构容器),Record 与
      // BindTree 的差异仅是类型层收窄,运行时形状已收敛。
      const spec = generated as unknown as RenderSpec;
      const frozen = await engine.freezeSpec(spec.concern, spec, {
        actor: 'agent',
        principal: `user:${sessionId}`,
      });
      const concern = frozen.spec.concern;
      const canvasUrl = `/canvas?concern=${encodeURIComponent(concern)}`;
      return Response.json({
        sessionId,
        driver: resolved,
        requestedDriver: requested,
        outcome: 'done',
        summary: `渲染已生成:${concern}(词条 ${frozen.spec.component})→ 画布 ${canvasUrl}`,
        messages: [
          {
            role: 'assistant',
            text: `已生成渲染「${concern}」(${frozen.spec.component}${
              frozen.frozen ? ',首次凝固' : ',复用已凝固布局'
            })→ 在画布打开:${canvasUrl}`,
          },
        ],
        steps: [],
        successes: [],
        render: { concern, spec: frozen.spec, frozenNow: frozen.frozen, canvasUrl },
      });
    }
  } catch {
    // 引擎/库故障:不吞——交回既分派,由循环或委托路径如实报告失败。
  }

  // delegated(T5 Phase B):派发 delegationWorkflow,响应委托 id 与轮询入口;
  // 轨迹/状态经事件日志(/api/delegations/<id>)查询,与 inline 的消息语义等价。
  if (mode === 'delegated') {
    try {
      const startRel = await resolveStartRel(baseUrl, goal, (url, init) => fetch(url, init));
      const { delegationId } = await dispatchDelegation({
        goal,
        driverKind: resolved,
        startRel,
        principal: `user:${sessionId}`,
        baseUrl,
      });
      return Response.json({
        mode: 'delegated',
        delegationId,
        statusUrl: `/api/delegations/${delegationId}`,
      });
    } catch (error) {
      // 派发失败据实 503(委托未出发;与 inline 的"失败也是 200"不同——
      // 这里连循环都没开始,客户端必须知道派发本身未成)。
      return Response.json(
        {
          error: `委托派发失败: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 503 },
      );
    }
  }

  // inline(T9 Phase B):SSE 流式响应——轨迹逐步可见(过程可见性);
  // 循环在流内跑完,客户端断开只中断推帧,不中断循环(服务端留痕完整)。
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let pushable = true;
      const send = (frame: Record<string, unknown>): void => {
        if (!pushable) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          // 客户端已断开(停止/关窗):停推帧,循环照常跑完。
          pushable = false;
        }
      };
      try {
        const startRel = await resolveStartRel(baseUrl, goal, (url, init) => fetch(url, init));
        // agent-decision 审计(T11 Phase B):包装 driver 在 decide 时刻捕获
        // (prompt/reasoning/op)——决策输入只存在于 decide 时的 DriverContext,
        // 执行后的 TrailStep 回推不出 prompt(捕获方案见 chat/decisions.ts)。
        const decisions: AgentDecisionDetail[] = [];
        const result = await runAgent(
          wrapDriverForAudit(createDriver(requested), resolved, (detail) =>
            decisions.push(detail),
          ),
          goal,
          {
            baseUrl,
            fetchImpl: (url, init) => fetch(url, init),
            actor: 'agent',
            principal: `user:${sessionId}`,
            channel: 'chat',
            startRel,
            onStep: (step) => {
              send({ type: 'step', message: stepToMessage(step), rel: step.rel });
            },
          },
        );

        const messages = trailToMessages(result);
        // max-steps 的上限说明不是轨迹步(无 TrailStep 可挂 onStep),补一帧,
        // 保持客户端「消息 = 各 step 帧文本」的重建口径与 trailToMessages 等值。
        for (const extra of messages.slice(result.steps.length)) {
          send({ type: 'step', message: extra });
        }

        // agent-decision 落库:inline 每步决策一条,与 chat-turn 同源同值
        // (actor/principal/channel);先于回合投影写入(决策在先,回合在后)。
        // 落库失败 console.error 不阻断响应(同 chat-turn 口径:审计是投影)。
        try {
          for (const detail of decisions) {
            await appendEvent(getDb(), {
              kind: 'agent-decision',
              actor: 'agent',
              principal: `user:${sessionId}`,
              channel: 'chat',
              rel: `chat:${sessionId}`,
              detail,
            });
          }
        } catch (persistError) {
          console.error('agent-decision 事件落库失败(不阻断聊天响应):', persistError);
        }

        // 聊天历史(B3):inline 回合完成(含 failed/max-steps)直写 chat-turn
        // 事件——与 worker 同一双写者模式;engine fold 忽略该 kind。落库失败
        // 不阻断聊天响应(历史是投影,丢失可从轨迹推知,响应才是合同)。
        // T11 Phase B:detail 增结构化 steps(result.steps 原样)——messages
        // 是人读投影,steps 是机器可读原料(架构决定 2)。
        const turnDetail: ChatTurnDetail = {
          sessionId,
          goal,
          outcome: result.outcome,
          summary: result.summary ?? null,
          messages,
          steps: result.steps,
          driver: resolved,
        };
        try {
          await appendEvent(getDb(), {
            kind: 'chat-turn',
            actor: 'agent',
            principal: `user:${sessionId}`,
            channel: 'chat',
            rel: `chat:${sessionId}`,
            detail: turnDetail,
          });
        } catch (persistError) {
          console.error('chat-turn 事件落库失败(不阻断聊天响应):', persistError);
        }

        send({
          type: 'final',
          payload: {
            sessionId,
            driver: resolved,
            requestedDriver: requested,
            outcome: result.outcome,
            summary: result.summary ?? null,
            steps: result.steps,
            successes: result.successes,
          },
        });
      } catch (error) {
        // 委托不崩溃:循环与 driver 都不应抛出;此处兜底为 error 帧(200 流内)。
        send({
          type: 'error',
          error: `聊天循环异常: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        try {
          controller.close();
        } catch {
          // 流已被客户端取消:关闭动作无副作用要求。
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
