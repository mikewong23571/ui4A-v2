import {
  THREAD_REFERENCE_CATEGORIES,
  fieldValues,
  type CognitiveSemanticsDeclarationV1,
  type EngineSnapshot,
  type ThreadReferenceCategory,
  type ThreadSnapshot,
  type ThreadStatus,
} from '@ui4a/shared';

import { threadInputRel } from './work-thread-input';

import type { ActionDefinition } from '../core/types';
import { entityHref, toSirenAction } from '../contract/siren/build';
import { projectCognitiveSemantics } from '../contract/cognitive-semantics';
import { CONFIRMATION_APPROVE_ACTION, CONFIRMATION_REJECT_ACTION } from '../execution/confirmation';
import type {
  GuardResultEntry,
  ProjectDeps,
  SirenAction,
  SirenEntity,
  SirenFieldPresentation,
  SirenLink,
} from '../contract/siren/types';

export const THREADS_REL = 'threads';
export const THREAD_CURRENT_REL = 'threads-current';
export const THREAD_HISTORY_REL = 'threads-history';
export const THREAD_REL_PREFIX = 'thread:';

const THREADS_PRESENTATION = {
  fields: [{ path: 'properties.title', title: '标题', role: 'identity' as const }],
  // F-04/T40:空工作线区消费声明引导,而非裸标题。
  emptyMeaning: 'ready-to-start' as const,
};

const noNodeFields = { 'collect-node-fields': false } as const;

export const THREAD_CREATE_ACTION: ActionDefinition = {
  name: 'create',
  title: '创建工作线',
  ...noNodeFields,
  fields: [
    {
      name: 'commandId',
      type: 'json',
      title: '提交标识',
      required: true,
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        pattern: '^[a-z0-9][a-z0-9._-]*$',
        'x-ui4a-input-owner': 'client',
      },
      description: '同一逻辑提交与重试复用此标识；改变目标后使用新标识',
    },
    {
      name: 'goal',
      type: 'textarea',
      title: '目标',
      required: true,
      minLength: 1,
      description: '这条线要达成什么,一句话说清',
    },
  ],
};

const referenceFields: ActionDefinition['fields'] = [
  {
    name: 'category',
    type: 'select',
    title: '类别',
    required: true,
    options: [...THREAD_REFERENCE_CATEGORIES],
  },
  {
    name: 'rel',
    type: 'text',
    title: '涉及对象',
    required: true,
    minLength: 1,
    // 示例用抽象形状而非真实 rel(T56 C7:文档示例不得与任何被授权裁剪的
    // 对象字面量相撞,静态说明文本不披露成员存在性)。
    description: '对象的合同路径(形如 集合:名字);通常经「＋添加涉及对象」的选择器挑选,无需手填',
  },
];

export const THREAD_ATTACH_ACTION: ActionDefinition = {
  name: 'attach',
  title: '添加涉及对象',
  ...noNodeFields,
  fields: referenceFields,
};

export const THREAD_DETACH_ACTION: ActionDefinition = {
  name: 'detach',
  title: '移出涉及对象',
  ...noNodeFields,
  fields: referenceFields,
};

export const THREAD_PAUSE_ACTION: ActionDefinition = {
  name: 'pause',
  title: '暂停工作线',
  ...noNodeFields,
};

export const THREAD_RESUME_ACTION: ActionDefinition = {
  name: 'resume',
  title: '恢复工作线',
  ...noNodeFields,
};

export const THREAD_COMPLETE_ACTION: ActionDefinition = {
  name: 'complete',
  title: '完成工作线',
  ...noNodeFields,
};

export const THREAD_ARCHIVE_ACTION: ActionDefinition = {
  name: 'archive',
  title: '归档工作线',
  'requires-confirmation': 'high' as const,
  ...noNodeFields,
};

const actionsByStatus: Readonly<Record<ThreadStatus, readonly ActionDefinition[]>> = {
  open: [
    THREAD_ATTACH_ACTION,
    THREAD_DETACH_ACTION,
    THREAD_PAUSE_ACTION,
    THREAD_COMPLETE_ACTION,
    THREAD_ARCHIVE_ACTION,
  ],
  paused: [
    THREAD_ATTACH_ACTION,
    THREAD_DETACH_ACTION,
    THREAD_RESUME_ACTION,
    THREAD_COMPLETE_ACTION,
    THREAD_ARCHIVE_ACTION,
  ],
  completed: [
    THREAD_ATTACH_ACTION,
    THREAD_DETACH_ACTION,
    THREAD_RESUME_ACTION,
    THREAD_ARCHIVE_ACTION,
  ],
  archived: [],
};

export function threadRel(id: string): string {
  return `${THREAD_REL_PREFIX}${id}`;
}

export function threadActionsForStatus(status: ThreadStatus): readonly ActionDefinition[] {
  return actionsByStatus[status];
}

interface ProjectedThreadReference {
  rel: string;
  status?: string;
  dangling: boolean;
}

function statusPointer(rel: string, snapshot: EngineSnapshot): ProjectedThreadReference {
  const instance = snapshot.instances[rel];
  if (instance !== undefined) return { rel, status: instance.node, dangling: false };
  const delegation = snapshot.delegations?.[rel];
  if (delegation !== undefined) return { rel, status: delegation.status, dangling: false };
  const confirmation = snapshot.confirmations?.[rel];
  if (confirmation !== undefined) return { rel, status: confirmation.status, dangling: false };
  const activation = snapshot.activations?.[rel];
  if (activation !== undefined) return { rel, status: activation.status, dangling: false };
  if (rel.startsWith(THREAD_REL_PREFIX)) {
    const thread = snapshot.threads?.[rel.slice(THREAD_REL_PREFIX.length)];
    if (thread !== undefined) return { rel, status: thread.status, dangling: false };
  }
  if (snapshot.artifacts?.[rel] !== undefined || rel in snapshot.collections) {
    return { rel, dangling: false };
  }
  return { rel, dangling: true };
}

function unblocked(actions: readonly ActionDefinition[]): GuardResultEntry[] {
  return actions.map((action) => ({ action: action.name, blocked: false, guards: [] }));
}

function eventAuditHref(baseHref: string | undefined, rel: string): string {
  const sequence = Number(rel.slice('event:'.length));
  return `${baseHref ?? ''}/api/events?afterSeq=${sequence - 1}`;
}

function referenceLinks(
  thread: ThreadSnapshot,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenLink[] {
  const links: SirenLink[] = [
    { rel: ['self'], href: entityHref(deps.baseHref, threadRel(thread.id)) },
  ];
  if (thread.goal.source === threadInputRel(thread.id)) {
    links.push({
      rel: ['source'],
      href: entityHref(deps.baseHref, thread.goal.source),
      title: '创建时的目标原文',
    });
  }
  for (const category of ['context', 'active', 'approval'] as const) {
    for (const rel of thread.references[category]) {
      const pointer = statusPointer(rel, snapshot);
      links.push({
        rel: pointer.dangling ? [category, 'dangling'] : [category],
        href: entityHref(deps.baseHref, rel),
      });
    }
  }
  for (const rel of thread.references.event) {
    links.push({ rel: ['event'], href: eventAuditHref(deps.baseHref, rel) });
  }
  return links;
}

/** T35 F-11:线程生命周期状态的任务语(数据层,渲染器零模板)。 */
const THREAD_STATUS_TITLES: Readonly<Record<ThreadStatus, string>> = {
  open: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

/**
 * D78 决定 2(D54 单一落点):工作线实体的版本化认知声明——本线是 principal 的
 * 责任组(groupRole),同时声明「当前责任(human-responsibility)」与「进行中工作
 * (work-queue)」两个区域语义;封闭词表零增。emptyMeaning 沿 T40 F-04 先例静态
 * 声明起步引导,消费侧(空态词位)只在无可见成员时渲染——被裁剪与真空同形,
 * 声明不携带全称否定(D78 决定 3)。
 */
const THREAD_COGNITIVE_DECLARATION: CognitiveSemanticsDeclarationV1 = {
  version: 1,
  traits: ['human-responsibility', 'work-queue'],
  groupRole: 'responsibility',
  emptyMeaning: 'ready-to-start',
};

/** 被引用对象的一行业务身份:实例取声明字段(identity/title;fields 是带 origin
 * 的 FieldValue,经 fieldValues 解包),其余取既有投影 identity。解析不出时
 * 返回 undefined——调用方决定兜底(导航成员回退 rel,来源显示干净省略)。 */
function resolvedReferenceLabel(rel: string, snapshot: EngineSnapshot): string | undefined {
  const instance = snapshot.instances[rel];
  if (instance !== undefined) {
    const fields = fieldValues(instance.fields);
    const declared = fields['identity'];
    if (typeof declared === 'string' && declared.trim() !== '') return declared.trim();
    const title = fields['title'];
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
  }
  const delegation = snapshot.delegations?.[rel];
  if (delegation !== undefined) return delegation.goal.verb;
  const confirmation = snapshot.confirmations?.[rel];
  if (confirmation !== undefined) {
    // 与确认投影的身份行同式(project.ts:targetAction · 由 actor 提议;快照无
    // identity 字段,此前按不存在的字段判型属死分支)。
    return `${confirmation.targetAction} · 由 ${confirmation.proposedBy.actor} 提议`;
  }
  // 来源可指向另一条工作线(thread:<id> 或裸 thread id 同 statusPointer 口径)。
  const threadId = rel.startsWith(THREAD_REL_PREFIX) ? rel.slice(THREAD_REL_PREFIX.length) : rel;
  const thread = snapshot.threads?.[threadId];
  if (thread !== undefined) return thread.goal.text.trim();
  return undefined;
}

function referenceIdentity(rel: string, snapshot: EngineSnapshot): string {
  return resolvedReferenceLabel(rel, snapshot) ?? rel;
}

/**
 * D78 决定 2(路线 A):与 context 同构的 thread-reference 角色成员卡——properties
 * {rel, identity, status?, category},identity 解析自被引对象的声明字段,dangling
 * 如实标注;status 携带合同状态原词(终局/未知不翻译,缺失省略)。approval 卡携带
 * 被引确认实体的声明动作(pending → approve/reject,人机同权;已决/悬挂无动作),
 * 经既有 membersDeclareActions 纯结构判定让 generic 规划器自动选 D50 责任卡。
 * 纯投影:全部字段可重建,事件/写入模型零变化。
 */
function threadMemberCard(
  category: Exclude<ThreadReferenceCategory, 'event'>,
  rel: string,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const pointer = statusPointer(rel, snapshot);
  const pending = snapshot.confirmations?.[rel];
  const confirmationActions: readonly ActionDefinition[] =
    category === 'approval' && pending?.status === 'pending'
      ? [CONFIRMATION_APPROVE_ACTION, CONFIRMATION_REJECT_ACTION]
      : [];
  const actions: SirenAction[] = confirmationActions.map((action) =>
    toSirenAction(action, [], deps.baseHref),
  );
  return {
    class: ['thread-reference', ...(pointer.dangling ? ['dangling'] : [])],
    properties: {
      rel,
      identity: referenceIdentity(rel, snapshot),
      // 合同状态原词逐字携带(终局/未知不翻译);dangling 走既有「对象不存在」
      // 任务语;无状态的归属(集合/工件)省略 status。
      ...(pointer.dangling
        ? { status: '对象不存在' }
        : pointer.status === undefined
          ? {}
          : { status: pointer.status }),
      category,
      presentation: projectCognitiveSemantics({
        declaration: {
          version: 1,
          traits:
            category === 'approval' && pending !== undefined
              ? pending.status === 'pending'
                ? ['human-responsibility']
                : ['human-responsibility', 'task-history']
              : ['work-queue'],
        },
      }),
    },
    actions,
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, rel) }],
  };
}

export function projectWorkThread(
  thread: ThreadSnapshot,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const declarations = threadActionsForStatus(thread.status);
  // T33"上次停在哪":首个 active 引用的状态指针任务语言行(无 active 回退线程
  // 状态);纯投影派生,渲染器零模板。
  const firstActive =
    thread.references.active.length > 0
      ? statusPointer(thread.references.active[0]!, snapshot)
      : undefined;
  // 无 active 时回退线程自身状态的任务语(F-21 残余:实例节点名标题化随
  // statusPointer 携带节点 title 后收敛)。
  const resume = `停在「${firstActive?.status ?? THREAD_STATUS_TITLES[thread.status]}」`;
  // D78 决定 2:角色成员卡与 properties 引用序同构(context → active → approval;
  // event 引用是审计链接,不落成员卡)。dangling/空线/归档线语义见 threadMemberCard。
  const memberCards = (['context', 'active', 'approval'] as const).flatMap((category) =>
    thread.references[category].map((rel) => threadMemberCard(category, rel, snapshot, deps)),
  );
  // F-08/T40 来源可读物优先:goal.source 是规范审计引用,可解析为合同指代时
  // 投影任务语,不可解析(chat/message UUID 等)干净省略——裸标识只在 raw 层。
  const goalSourceText = resolvedReferenceLabel(thread.goal.source, snapshot);
  // D54 单一落点:fields 读字段声明 + 版本化认知声明(D78 决定 2)合并为
  // version:1 presentation;渲染器只消费语义,零 class/rel 分支。
  const threadFields: SirenFieldPresentation[] = [
    { path: 'properties.identity', title: '目标', role: 'identity' },
    { path: 'properties.statusText', title: '状态', role: 'status' },
    { path: 'properties.resume', title: '上次停在哪', role: 'primary-content' },
    ...(goalSourceText === undefined
      ? []
      : [{ path: 'properties.goalSourceText', title: '目标来源', role: 'metadata' as const }]),
  ];
  const presentation = projectCognitiveSemantics({
    declaration: THREAD_COGNITIVE_DECLARATION,
    fieldPresentations: threadFields,
  });
  return {
    class: ['work-thread', thread.status],
    properties: {
      rel: threadRel(thread.id),
      identity: thread.goal.text.trim(),
      id: thread.id,
      owner: thread.owner,
      goal: thread.goal,
      status: thread.status,
      statusText: THREAD_STATUS_TITLES[thread.status],
      context: [...thread.references.context],
      ...(firstActive === undefined ? {} : { resume }),
      active: thread.references.active.map((rel) => statusPointer(rel, snapshot)),
      approval: thread.references.approval.map((rel) => statusPointer(rel, snapshot)),
      'recent-events': [...thread.recentEventSeqs],
      ...(goalSourceText === undefined ? {} : { goalSourceText }),
      presentation,
    },
    actions: declarations.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: referenceLinks(thread, snapshot, deps),
    'guard-results': unblocked(declarations),
    entities: memberCards,
  };
}

export function projectWorkThreads(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const threads = Object.values(snapshot.threads ?? {});
  return {
    class: ['collection', THREADS_REL],
    properties: {
      rel: THREADS_REL,
      title: '我的工作线',
      count: threads.length,
      presentation: THREADS_PRESENTATION,
    },
    actions: [toSirenAction(THREAD_CREATE_ACTION, [], deps.baseHref)],
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, THREADS_REL), title: '我的工作线' },
      { rel: ['current'], href: entityHref(deps.baseHref, THREAD_CURRENT_REL), title: '继续工作' },
      {
        rel: ['history'],
        href: entityHref(deps.baseHref, THREAD_HISTORY_REL),
        title: '已结束的工作',
      },
    ],
    'guard-results': unblocked([THREAD_CREATE_ACTION]),
    entities: threads.map((thread) => ({
      ...projectWorkThread(thread, snapshot, deps),
      rel: ['item'],
      href: entityHref(deps.baseHref, threadRel(thread.id)),
    })),
  };
}
