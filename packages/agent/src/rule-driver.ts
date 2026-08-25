/**
 * rule driver:纯启发式协议测试 fixture。产品 runtime 不导入、不 fallback，
 * 仅通过 @ui4a/agent/testkit/rule-driver 的显式测试子路径提供。
 *
 * 目标相关性决策次序(arch-brief §5 原样,逐层带停止条件):
 * ⓪ app 定位层(T10 架构决定 6,软边界):目标词命中某 app 的 name/intent
 *   → 该 app 组内与目标词有交集且入口可达的 flow 入口优先;不做硬过滤——
 *   全部命中 app 都无可选时回退以下现有链(跨 app links 天然合法)。
 * ① 点名的资源:targetRel/resource 出现在 links/子实体里 → navigate 直达;
 *   停止条件:已在点名资源上(落入②)。
 * ② 点名的动作:goal.verb 与 action name/title 词级交集 → exec;
 *   停止条件:guard-results 标记 blocked、guard/undeclared 已拒(换路径)。
 * ③ 相关节点上的流程推进词:向导 next(字段按当前步 schema 过滤)/
 *   队列逐条点名待处理成员 / 队列成员沿 collection 回链回队列视图。
 * ④ 自由漫游:sitemap surfaces(静态上下文)命中目标词且入口可达 → 沿入口进入;
 *   否则沿 links 走到与目标有词级交集处;无交集可走 → fail。
 *
 * done 判定(完成类动作成功过,相对目标):
 * - 发布类:publish 词级匹配的成功存在,且当前实体无剩余目标相关动作;
 * - 下线类:目标 rel 上 unpublish 成功(点名目标时成功必须在目标上);
 * - 审核类(队列目标):≥1 次 approve 成功且队列视图上待处理清零。
 *
 * 拒绝即数据:
 * - schema-invalid → 字段级自救:按 schema 默认值(缺省时枚举首项)补齐重试,最多一次;
 * - guard-failed/undeclared → 换路径(同 rel+action 不再直投)。
 * 状态全部从 DriverContext 推导(trail/successes/lastRejection),driver 无私有状态。
 */
import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { anyTokenInString, asciiTokens, expandVerb } from './match';
import { navigableRels, relFromHref } from './navigation';
import { ADVANCE_TOKENS } from './progress';
import type { AgentDriver, AgentGoal, AgentOperation, DriverContext } from './types';

/** 队列类目标特征词(③/ done 判定按队列语义处理)。 */
const QUEUE_HINTS = ['审核', 'approve', 'moderate', 'review', '队列', 'queue', '处理'];

export function createRuleDriver(): AgentDriver {
  return { decide: ruleDecide };
}

// ---- 实体形状小工具 --------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInstanceEntity(entity: SirenEntity): boolean {
  return entity.class.includes('flow-instance');
}

function isCollectionEntity(entity: SirenEntity): boolean {
  return entity.class.includes('collection');
}

/** guard-results 里被阻断的动作名(拒绝即教育:不再直投)。 */
function blockedActionNames(entity: SirenEntity): Set<string> {
  return new Set(
    (entity['guard-results'] ?? []).filter((entry) => entry.blocked).map((entry) => entry.action),
  );
}

/** 与目标词有词级交集且未被 guard 阻断的动作。 */
function goalOverlappingActions(
  entity: { actions: SirenAction[]; 'guard-results'?: SirenEntity['guard-results'] },
  goalTokens: readonly string[],
): SirenAction[] {
  const blocked = blockedActionNames(entity as SirenEntity);
  return entity.actions.filter(
    (action) =>
      !blocked.has(action.name) && anyTokenInString(goalTokens, `${action.name} ${action.title}`),
  );
}

/** 队列视角:仍声明目标动作的待处理成员。 */
function pendingMembers(entity: SirenEntity, goalTokens: readonly string[]): SirenEntity[] {
  return (entity.entities ?? []).filter(
    (sub) => goalOverlappingActions(sub, goalTokens).length > 0,
  );
}

function isQueueGoal(context: DriverContext): boolean {
  return anyTokenInString(QUEUE_HINTS, context.goal.verb);
}

/** 成功是否落在点名的目标上(未点名目标时任意 rel 均可)。 */
function successOnTarget(rel: string, goal: AgentGoal): boolean {
  if (goal.targetRel !== undefined) return rel === goal.targetRel;
  if (goal.resource !== undefined) return rel.includes(goal.resource);
  return true;
}

// ---- 拒绝即数据:路径切换与字段自救 ----------------------------------------

/** guard/undeclared 已拒的 (rel,action):换路径,不再直投。 */
function hardRejected(context: DriverContext, actionName: string): boolean {
  const rejection = context.lastRejection;
  return (
    rejection !== undefined &&
    rejection.rel === context.currentRel &&
    rejection.action === actionName &&
    (rejection.layer === 'guard-failed' || rejection.layer === 'undeclared')
  );
}

/** 同一 (rel,action) 的 schema-invalid 拒绝次数与最近参数(trail 优先,孤立的 lastRejection 计一次)。 */
function schemaRejectionState(
  context: DriverContext,
  actionName: string,
): { count: number; lastParams: Record<string, unknown> } {
  const matches = (rejection: { rel?: string; action?: string; layer?: string }): boolean =>
    rejection.rel === context.currentRel &&
    rejection.action === actionName &&
    rejection.layer === 'schema-invalid';

  const steps = context.trail.filter(
    (step) =>
      step.outcome === 'rejected' &&
      step.op.kind === 'exec' &&
      step.op.action === actionName &&
      step.rejection !== undefined &&
      matches(step.rejection),
  );
  if (steps.length > 0) {
    const last = steps[steps.length - 1]!;
    return {
      count: steps.length,
      lastParams: last.op.kind === 'exec' ? (last.op.params ?? {}) : {},
    };
  }
  const rejection = context.lastRejection;
  if (rejection !== undefined && matches(rejection)) {
    return { count: 1, lastParams: rejection.params ?? {} };
  }
  return { count: 0, lastParams: {} };
}

/** action.fields(JSON Schema)的 properties。 */
function schemaProperties(action: SirenAction): Record<string, Record<string, unknown>> {
  const fields = action.fields;
  if (!isPlainObject(fields) || !isPlainObject(fields.properties)) return {};
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, property] of Object.entries(fields.properties)) {
    if (isPlainObject(property)) properties[name] = property;
  }
  return properties;
}

/**
 * 常规组参:goal.fields 优先,schema 声明的 default 兜底(事实永不发明——
 * 只取显式声明的默认值,不猜)。
 */
function buildParams(
  fields: Record<string, unknown> | undefined,
  action: SirenAction,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(schemaProperties(action))) {
    if (fields !== undefined && name in fields) {
      params[name] = fields[name];
    } else if (property.default !== undefined) {
      params[name] = property.default;
    }
  }
  return params;
}

/** 字段自救:在既有参数上补 schema 默认值,缺省时取枚举首项(最多一次的重试载荷)。 */
function fillDefaults(
  prior: Record<string, unknown>,
  action: SirenAction,
): Record<string, unknown> {
  const params = { ...prior };
  for (const [name, property] of Object.entries(schemaProperties(action))) {
    if (name in params) continue;
    if (property.default !== undefined) {
      params[name] = property.default;
    } else if (Array.isArray(property.enum) && property.enum.length > 0) {
      params[name] = property.enum[0];
    }
  }
  return params;
}

/**
 * 对目标动作产出一个 exec(应用换路径与字段自救规则);
 * 返回 undefined 表示该动作本轮应跳过。
 */
function execOperation(context: DriverContext, action: SirenAction): AgentOperation | undefined {
  const { count, lastParams } = schemaRejectionState(context, action.name);
  if (count >= 2) return undefined; // 自救已用尽,放弃
  if (count === 1) {
    return {
      kind: 'exec',
      action: action.name,
      params: fillDefaults(lastParams, action),
    };
  }
  if (hardRejected(context, action.name)) return undefined; // 换路径
  return {
    kind: 'exec',
    action: action.name,
    params: buildParams(context.goal.fields, action),
  };
}

// ---- 决策层(⓪ app 定位 + ①–④ 目标相关性)----------------------------------

/** 入口 rel 在当前实体可达时返回其实际 rel(精确命中,或 :别名 后缀命中)。 */
function reachableEntryRel(candidates: readonly string[], entryRel: string): string | undefined {
  return (
    candidates.find((rel) => rel === entryRel) ??
    // 入口链接的 rel 可能是别名(flow:x),也可能指向实例——两者都试。
    candidates.find((rel) => rel.endsWith(`:${entryRel.split(':').pop()}`))
  );
}

/**
 * ⓪ app 定位层:目标词(verb 展开词)先匹配 app 的 name/intent,命中则该 app
 * 组内的 flow/资源入口优先。
 * 命中口径(确定性):applications 按 sitemap 声明序先到先得,组内 flows 同序;
 * 组内无可选(与目标词无交集或入口不可达)顺延下一个命中 app;全部落空返回
 * undefined——不做硬过滤,决策链回退现状,无命中时行为与此前完全一致。
 */
function appLocationDecision(
  context: DriverContext,
  goalTokens: readonly string[],
): AgentOperation | undefined {
  const applications = context.sitemap?.applications;
  if (applications === undefined || applications.length === 0) return undefined;
  const candidates = navigableRels(context.entity, context.currentRel);
  for (const app of applications) {
    if (!anyTokenInString(goalTokens, `${app.name} ${app.intent}`)) continue;
    for (const flow of app.flows) {
      if (!anyTokenInString(goalTokens, `${flow.name} ${flow.title}`)) continue;
      const entryRel = reachableEntryRel(candidates, `flow:${flow.name}`);
      if (entryRel !== undefined) return { kind: 'navigate', rel: entryRel };
    }
  }
  return undefined;
}

/** done 判定:完成类动作成功过,且(队列目标)待处理清零。 */
function doneDecision(
  context: DriverContext,
  goalTokens: readonly string[],
): AgentOperation | undefined {
  const success = context.successes.find(
    (entry) =>
      anyTokenInString(goalTokens, entry.action) && successOnTarget(entry.rel, context.goal),
  );
  if (success === undefined) return undefined;

  if (isQueueGoal(context)) {
    // 队列目标必须在队列视图上确认清零(成员实体看不到全队列)。
    if (!isCollectionEntity(context.entity)) return undefined;
    if (pendingMembers(context.entity, goalTokens).length > 0) return undefined;
    return { kind: 'done', summary: `目标完成: ${success.action} 已成功,待处理清零` };
  }
  // 非队列目标:当前实体/子实体仍有目标相关动作 → 目标未尽,继续。
  if (goalOverlappingActions(context.entity, goalTokens).length > 0) return undefined;
  for (const sub of context.entity.entities ?? []) {
    if (goalOverlappingActions(sub, goalTokens).length > 0) return undefined;
  }
  return { kind: 'done', summary: `目标完成: ${success.action} 已成功` };
}

/** ① 点名的资源:links/子实体里出现 → navigate 直达。 */
function namedResourceDecision(context: DriverContext): AgentOperation | undefined {
  const { targetRel, resource } = context.goal;
  if (targetRel === undefined && resource === undefined) return undefined;
  const current = context.currentRel;
  const atTarget =
    (targetRel !== undefined && current === targetRel) ||
    (resource !== undefined && current.includes(resource));
  if (atTarget) return undefined; // 停止条件:已直达

  const candidates = navigableRels(context.entity, current);
  const hit =
    (targetRel !== undefined ? candidates.find((rel) => rel === targetRel) : undefined) ??
    (resource !== undefined
      ? candidates.find((rel) => rel.includes(resource) || rel.split(':').pop() === resource)
      : undefined);
  if (hit === undefined) return undefined;
  return { kind: 'navigate', rel: hit };
}

/** ② 点名的动作:goal.verb 与 action name/title 词级交集 → exec。 */
function namedActionDecision(
  context: DriverContext,
  goalTokens: readonly string[],
): AgentOperation | undefined {
  for (const action of goalOverlappingActions(context.entity, goalTokens)) {
    const op = execOperation(context, action);
    if (op !== undefined) return op;
  }
  return undefined;
}

/** ③ 相关节点上的流程推进:向导 next / 队列逐条 / 成员回集合。 */
function flowAdvanceDecision(
  context: DriverContext,
  goalTokens: readonly string[],
): AgentOperation | undefined {
  const entity = context.entity;

  if (isInstanceEntity(entity)) {
    const advance = entity.actions.find(
      (action) =>
        !blockedActionNames(entity).has(action.name) &&
        !hardRejected(context, action.name) &&
        anyTokenInString(ADVANCE_TOKENS, `${action.name} ${action.title}`),
    );
    if (advance !== undefined) {
      const op = execOperation(context, advance);
      if (op !== undefined) return op;
    }
  }

  if (isQueueGoal(context)) {
    if (isCollectionEntity(entity)) {
      for (const member of pendingMembers(entity, goalTokens)) {
        const rel = member.properties.rel;
        const memberRel = typeof rel === 'string' && rel !== '' ? rel : relFromHref(member.href);
        if (memberRel === undefined || memberRel === context.currentRel) continue;
        const alreadySucceeded = context.successes.some(
          (entry) => entry.rel === memberRel && anyTokenInString(goalTokens, entry.action),
        );
        if (alreadySucceeded) continue;
        return { kind: 'navigate', rel: memberRel };
      }
    } else {
      const collectionHref = entity.links.find((link) => link.rel.includes('collection'))?.href;
      const collectionRel = relFromHref(collectionHref);
      if (collectionRel !== undefined && collectionRel !== context.currentRel) {
        return { kind: 'navigate', rel: collectionRel };
      }
    }
  }
  return undefined;
}

/** ④ 自由漫游:沿 links 走到与目标有词级交集处;无路 → fail。 */
function freeRoamDecision(context: DriverContext, goalTokens: readonly string[]): AgentOperation {
  const hints = [...goalTokens];
  if (context.goal.resource !== undefined) hints.push(context.goal.resource);
  if (context.goal.targetRel !== undefined) {
    hints.push(context.goal.targetRel, ...asciiTokens(context.goal.targetRel));
  }
  const candidates = navigableRels(context.entity, context.currentRel);

  // sitemap surfaces 是 agent 的静态上下文(缓存结构第四层的 tool 版):
  // 目标词命中某表面的 rel/title 且该表面入口在当前实体 links 上 → 沿入口进入。
  // 例:目标"发布"命中"文章发布向导"(flow:article-drafting)→ 从 articles 进入向导。
  if (context.sitemap !== undefined) {
    for (const surface of context.sitemap.surfaces) {
      if (!anyTokenInString(hints, `${surface.rel} ${surface.title}`)) continue;
      const entryRel = reachableEntryRel(candidates, surface.rel);
      if (entryRel !== undefined) return { kind: 'navigate', rel: entryRel };
    }
  }

  const hit = candidates.find((rel) => anyTokenInString(hints, rel));
  if (hit === undefined) {
    return {
      kind: 'fail',
      reason: `无与目标相关的可导航路径(当前 ${context.currentRel};候选:[${candidates.join(', ')}])`,
    };
  }
  return { kind: 'navigate', rel: hit };
}

function ruleDecide(context: DriverContext): AgentOperation {
  const goalTokens = expandVerb(context.goal.verb);
  return (
    doneDecision(context, goalTokens) ??
    appLocationDecision(context, goalTokens) ??
    namedResourceDecision(context) ??
    namedActionDecision(context, goalTokens) ??
    flowAdvanceDecision(context, goalTokens) ??
    freeRoamDecision(context, goalTokens)
  );
}
