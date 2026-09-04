/**
 * fold 投影:事件日志 → 引擎快照的纯函数(arch-brief §4 事件溯源)。
 *
 * "当前 UI 状态 = 日志折叠后的物化状态";应用核心是日志的纯函数(I5 的根基)。
 * 与在线路径同构:在线 exec = judge(裁决) → applyEffects(效果) → appendEvent(s) →
 * 增量持有新快照;重放 = fold(全部事件) —— 每条 action-executed 事件还原成
 * ExecRequest 后重放同一个 applyEffects(同一 flow 常量、同一效果词汇表),
 * 两条路径产出相同快照(由 I5 集成测试以内容 hash 断言)。
 *
 * 放在 engine(而非 web service 层)的理由:fold 是"应用核心"本体且纯(零 Node API,
 * 两栖),worker(T3 消费 spawn-requested)与任何重放工具都需要它;
 * 日志形状(LogEvent)因此成为引擎公共合同的一部分。
 *
 * 模块切分(T23 Phase D,纯搬运):log-event(日志形状)/ apply-seed(种子族)/
 * apply-confirmation(确认链)/ apply-definition(定义事件族)/ 本文件(action-executed
 * 重放 + fold 主循环)。公开面与原 src/fold.ts 一致。
 */
import { fieldValues } from '@ui4a/shared';
import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';

import { applyEffects } from '../../execution/effects';
import type { ExecRequest } from '../../execution/judge';
import { withLifecycleFlows } from '../../definition/lifecycle';
import { actionEffects } from '../../core/parse';
import { applyRenderSpecFrozen } from '../render-spec';
import { applyCapabilityArtifactCreated } from '../capability-artifact';
import {
  applyDelegationStarted,
  applyDelegationStep,
  applyDelegationTerminal,
} from '../../delegation/delegation';
import {
  applyDefinitionCandidate,
  type DefinitionCandidateAppliedDetail,
} from '../../submission/apply';
import { applyApplicationSeeded, applyCapabilitySeeded, applySeed } from './apply-seed';
import { applyApplicationDeprecated } from './apply-application-deprecated';
import {
  applyConfirmationDecision,
  applyConfirmationRequested,
  applyNotificationDelivered,
} from './apply-confirmation';
import {
  applyDefinitionActivated,
  applyDefinitionDeprecated,
  applyDefinitionRejected,
  applyDefinitionRevised,
  applyDefinitionSeeded,
  applyDefinitionSubmitted,
} from './apply-definition';
import type { LogEvent } from './log-event';
import type { FoldSnapshot } from './state';
import { applyThreadEvent } from './apply-thread';

export * from './log-event';
export * from './state';

/** 由事件参数(带出处)还原 exec 请求的求值输入。 */
function toExecRequest(event: LogEvent): ExecRequest {
  const params = event.params ?? {};
  return {
    rel: event.rel ?? '',
    action: event.action ?? '',
    params: fieldValues(params),
    paramOrigins: Object.fromEntries(
      Object.entries(params).map(([name, entry]) => [name, entry.origin]),
    ),
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
  };
}

/**
 * 重放一条 action-executed:定义解析以**快照为准**(T4 Phase B:定义来自日志)——
 * 实例带出生版本戳按 definitionVersions[bornVersion] 取,否则取该 flow 当前活跃
 * 版本;快照无该 flow 定义(测试 fixture/常量域)才回退 deps.flows 常量。
 * 日志与定义漂移时响亮失败(带 seq)——日志 + 定义 = 完整重放输入,任何缺口都
 * 必须被 I5 级测试看见。
 */
function instanceFlowFromSnapshot(
  snapshot: EngineSnapshot,
  instance: EngineSnapshot['instances'][string],
): FlowDefinition | undefined {
  const entry = snapshot.definitions?.[instance.flow];
  if (entry === undefined) return undefined;
  const version = instance.bornVersion ?? entry.version;
  return snapshot.definitionVersions?.[instance.flow]?.[version] ?? entry.definition;
}

function applyExecuted(
  snapshot: EngineSnapshot,
  event: LogEvent,
  flows: Readonly<Record<string, FlowDefinition>>,
): EngineSnapshot {
  const request = toExecRequest(event);
  const where = `seq=${event.seq}(${request.rel}#${request.action})`;

  const instance = snapshot.instances[request.rel];
  if (instance === undefined) {
    throw new Error(`重放失败:${where} 实例不存在(日志与状态漂移)`);
  }
  const flow = instanceFlowFromSnapshot(snapshot, instance) ?? flows[instance.flow];
  if (flow === undefined) {
    throw new Error(`重放失败:${where} 流程 "${instance.flow}" 未注册(定义漂移)`);
  }
  const node = flow.nodes.find((candidate) => candidate.name === instance.node);
  if (node === undefined) {
    throw new Error(`重放失败:${where} 节点 "${instance.node}" 不在流程 "${flow.name}" 节点集`);
  }
  const action = node.actions.find((candidate) => candidate.name === request.action);
  if (action === undefined) {
    throw new Error(`重放失败:${where} 动作未声明于节点 "${node.name}"(定义与日志漂移)`);
  }

  try {
    // versions 随快照传入:transition 校验同样按出生版本解析(与在线一致)。
    return applyEffects(request, actionEffects(action), snapshot, {
      flows,
      versions: snapshot.definitionVersions,
    }).snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`重放失败:${where} ${message}`);
  }
}

/**
 * 折叠事件日志为引擎快照(纯函数;events 须按 seq 升序传入)。
 *
 * - action-executed:重放 applyEffects(在线路径同一函数);
 * - action-rejected:不改状态(拒绝即数据,留痕在日志本身,I6);
 * - entity-appended / spawn-requested:伴随事件——状态已由同批 action-executed
 *   重放体现(append 由 applyEffects 落位;spawn 在 T2 不改状态),fold 不双算;
 * - confirmation-requested:pending 确认实体物化(目标动作不生效);
 * - confirmation-approved:状态 → approved(实体保留);紧随其后的 action-executed
 *   照常重放(挂起→approve 重放后效果必须出现,I5);
 * - confirmation-rejected:状态 → rejected(原因保留),原动作永不生效;
 * - notification-delivered:确认标记 notified=true(worker 第二写者的送达事件,
 *   重复幂等;spec 决定 4 双写者方案);
 * - delegation-started / -step / -completed | -failed | -max-steps(T5):委托
 *   事件族折叠为 delegations 表(worker delegationWorkflow 的轨迹;step 步号
 *   连续性在 fold 层强制,缺口即抛错);
 * - render-spec-frozen(T7):凝固渲染 spec 物化为 renderSpecs 表
 *   (concern → spec;同 spec 重复幂等,异 spec 抛错——凝固语义);
 * - seed:合并种子实体(幂等);
 * - definition-seeded(T4):建立 definitions 条目 + lifecycle 实例(幂等);
 * - application-seeded(T10):活跃 app 定义落 applications 表(幂等;
 *   seeded 即 active,键集 = app-known 已激活集合);
 * - application-deprecated(T52/D71.1):受治理应用停用级联——applications
 *   删键、deprecatedApplications 审计集留痕、app === name 的定义条目置
 *   deprecated(幂等:重复停用审计首写为准);
 * - capability-seeded(T13):已注册 capability 定义落 capabilities 表(幂等;
 *   seeded 即 registered,键集 = capability-registered 已注册集合);
 * - definition-edited:伴随事件——工作副本已由同批 action-executed 重放
 *   (applyEffects 的 meta-edit),fold 不双算;
 * - definition-revised / -deprecated:条目状态落态(转移由前置 action-executed
 *   重放,此处核对 + 条目同步);
 * - definition-submitted:载荷即真相——passed 则 pending-approval + activation
 *   物化;fail 则回 draft(校验报告即 checks 失败项);
 * - definition-activated / -rejected:approve/reject 落态(版本推进/驳回留痕;
 *   转移由前置 action-executed 重放,此处核对 + 条目与 activation 同步);
 * - chat-turn(T9 Phase B):聊天回合投影——纯审计留痕,fold 不改状态;
 * - agent-decision(T11 Phase B):inline 每步决策审计——纯留痕,fold 不改状态;
 * - 未知 kind:抛错(日志完整性守卫)。
 *
 * initial(可选):从既有快照继续折叠——web 读路径按 seq 增量 fold 的根基
 * (增量结果与全量 fold 同构,由测试以内容 hash 断言;缺省从空快照起步)。
 */
export function fold(
  events: readonly LogEvent[],
  deps: { flows: Readonly<Record<string, FlowDefinition>> },
  initial?: FoldSnapshot,
): FoldSnapshot {
  // T4:lifecycle 常量自动注入(保留名)——meta 动作的 action-executed 重放
  // 需要 definition-lifecycle,调用方无须自带。
  const flows = withLifecycleFlows(deps.flows);
  let snapshot: FoldSnapshot =
    initial === undefined
      ? {
          instances: {},
          collections: {},
          confirmations: {},
          delegations: {},
          definitions: {},
          activations: {},
          definitionVersions: {},
          renderSpecs: {},
          artifacts: {},
          threads: {},
        }
      : {
          instances: initial.instances,
          collections: initial.collections,
          confirmations: initial.confirmations ?? {},
          // T5:delegations 表随行(与 confirmations 同口径:在线恒物化,
          // 重放同构前提是两边形状一致)。
          delegations: initial.delegations ?? {},
          // T4:definitions/activations 表随行(在线 applyEffects 恒物化,
          // 重放同构前提是两边形状一致);definitionVersions(T4 Phase B)同口径。
          definitions: initial.definitions ?? {},
          activations: initial.activations ?? {},
          definitionVersions: initial.definitionVersions ?? {},
          // T7:renderSpecs 表随行(凝固表恒物化,同口径)。
          renderSpecs: initial.renderSpecs ?? {},
          // T10:applications 表随行,但仅在场时携带——缺省不物化为 {}
          // (app-known 过渡期 vacuous pass 信号;与 applyEffects 同口径)。
          ...(initial.applications !== undefined ? { applications: initial.applications } : {}),
          // T13:capabilities 表随行,与 applications 同口径(仅在场时携带;
          // capability-registered 过渡期 vacuous pass 信号)。
          ...(initial.capabilities !== undefined ? { capabilities: initial.capabilities } : {}),
          // T52:deprecatedApplications 停用审计表随行,与 applications 同口径
          // (仅在场时携带;经 application-deprecated 折叠落表)。
          ...(initial.deprecatedApplications !== undefined
            ? { deprecatedApplications: initial.deprecatedApplications }
            : {}),
          artifacts: initial.artifacts ?? {},
          threads: initial.threads ?? {},
        };
  for (const event of events) {
    switch (event.kind) {
      case 'seed':
        snapshot = applySeed(snapshot, event);
        break;
      case 'definition-seeded':
        snapshot = applyDefinitionSeeded(snapshot, event);
        break;
      case 'application-seeded':
        snapshot = applyApplicationSeeded(snapshot, event);
        break;
      case 'application-deprecated':
        snapshot = applyApplicationDeprecated(snapshot, event);
        break;
      case 'capability-seeded':
        snapshot = applyCapabilitySeeded(snapshot, event);
        break;
      case 'definition-edited':
        break;
      case 'definition-revised':
        snapshot = applyDefinitionRevised(snapshot, event);
        break;
      case 'definition-deprecated':
        snapshot = applyDefinitionDeprecated(snapshot, event);
        break;
      case 'definition-submitted':
        snapshot = applyDefinitionSubmitted(snapshot, event);
        break;
      case 'definition-activated':
        snapshot = applyDefinitionActivated(snapshot, event);
        break;
      case 'definition-candidate-applied':
        snapshot = applyDefinitionCandidate(
          snapshot,
          event.detail as DefinitionCandidateAppliedDetail,
        );
        break;
      case 'definition-rejected':
        snapshot = applyDefinitionRejected(snapshot, event);
        break;
      case 'action-executed':
        snapshot = applyExecuted(snapshot, event, flows);
        break;
      case 'confirmation-requested':
        snapshot = applyConfirmationRequested(snapshot, event);
        break;
      case 'confirmation-approved':
        snapshot = applyConfirmationDecision(snapshot, event, 'approved');
        break;
      case 'confirmation-rejected':
        snapshot = applyConfirmationDecision(snapshot, event, 'rejected');
        break;
      case 'notification-delivered':
        snapshot = applyNotificationDelivered(snapshot, event);
        break;
      case 'delegation-started':
        snapshot = applyDelegationStarted(snapshot, event);
        break;
      case 'delegation-step':
        snapshot = applyDelegationStep(snapshot, event);
        break;
      case 'delegation-completed':
      case 'delegation-failed':
      case 'delegation-max-steps':
        snapshot = applyDelegationTerminal(snapshot, event, event.kind);
        break;
      case 'render-spec-frozen':
        snapshot = applyRenderSpecFrozen(snapshot, event);
        break;
      case 'capability-artifact-created':
        snapshot = applyCapabilityArtifactCreated(snapshot, event);
        break;
      case 'thread-created':
      case 'thread-reference-attached':
      case 'thread-reference-detached':
      case 'thread-status-changed':
        snapshot = applyThreadEvent(snapshot, event);
        break;
      case 'action-rejected':
      case 'entity-appended':
      case 'spawn-requested':
      // plan-executed(T6):批量裁决记录——纯标记,状态由同批各步伴随事件
      // (action-executed / confirmation-requested 族)重放,fold 不双算。
      case 'plan-executed':
      // chat-turn(T9 Phase B):聊天回合投影——纯审计留痕(消息全文在 detail),
      // 状态与引擎无关,fold 忽略;历史读路径走 /api/chat/history 的日志过滤。
      case 'chat-turn':
      case 'chat-turn-started':
      case 'chat-turn-progress':
      // T15:raw dialogue 与 derived conversation context 是 append-only 审计事实；
      // 专用 conversation fold 消费它们，业务引擎快照保持不变。
      case 'chat-message-appended':
      case 'chat-context-updated':
      case 'chat-navigation-completed':
      // agent-decision(T11 Phase B):inline 每步决策审计(step/driver/prompt/
      // reasoning/op 在 detail)——纯留痕,fold 忽略,与 chat-turn 同口径。
      case 'agent-decision':
      // meta-bootstrap-applied:应用制品安装 receipt；状态由同批 seed 事件物化。
      case 'meta-bootstrap-applied':
        break;
      default:
        throw new Error(`重放失败:未知事件 kind "${String(event.kind)}"(seq=${event.seq})`);
    }
  }
  return snapshot;
}
