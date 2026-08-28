import {
  THREAD_REFERENCE_CATEGORIES,
  type EngineSnapshot,
  type ThreadSnapshot,
  type ThreadStatus,
} from '@ui4a/shared';

import type { ActionDefinition } from '../core/types';
import { entityHref, toSirenAction } from '../contract/siren/build';
import type {
  GuardResultEntry,
  ProjectDeps,
  SirenEntity,
  SirenLink,
} from '../contract/siren/types';

export const THREADS_REL = 'threads';
export const THREAD_REL_PREFIX = 'thread:';

const THREADS_PRESENTATION = {
  fields: [{ path: 'properties.title', title: '标题', role: 'identity' as const }],
};

const noNodeFields = { 'collect-node-fields': false } as const;

export const THREAD_CREATE_ACTION: ActionDefinition = {
  name: 'create',
  title: '创建工作线',
  ...noNodeFields,
  fields: [
    { name: 'id', type: 'text', title: '工作线标识', required: true, minLength: 1 },
    { name: 'goal', type: 'textarea', title: '目标', required: true, minLength: 1 },
    {
      name: 'goalSource',
      type: 'text',
      title: '目标来源',
      required: true,
      minLength: 1,
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
    description: '对象的合同路径(如 post:first-post);可从画布成员卡或助手处获得',
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

/** 被引用对象的一行业务身份:实例取标题,其余取既有投影 identity,回退 rel。 */
function referenceIdentity(rel: string, snapshot: EngineSnapshot): string {
  const instance = snapshot.instances[rel];
  if (instance !== undefined) {
    const title = instance.fields['title'];
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
  }
  const delegation = snapshot.delegations?.[rel];
  if (delegation !== undefined) return delegation.goal.verb;
  const confirmation = snapshot.confirmations?.[rel];
  if (confirmation !== undefined) {
    const identity = confirmation.identity;
    if (typeof identity === 'string' && identity !== '') return identity;
  }
  return rel;
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
  const resume = `停在「${firstActive?.status ?? thread.status}」`;
  // T35 F-11/F-27:材料清单(上下文包)投影为可导航成员卡——身份解析自被引
  // 对象(标题/目标/identity),dangling 如实标注;挂载/移除仍是线程动作(W 阶段
  // 升级为清单内操作)。
  const contextMembers = thread.references.context.map((ref) => {
    const pointer = statusPointer(ref, snapshot);
    return {
      class: ['thread-reference', ...(pointer.dangling ? ['dangling'] : [])],
      properties: {
        rel: ref,
        identity: referenceIdentity(ref, snapshot),
        status: pointer.status ?? (pointer.dangling ? '对象不存在' : undefined),
      },
      actions: [],
      links: [{ rel: ['self'], href: entityHref(deps.baseHref, ref) }],
    };
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
      resume,
      active: thread.references.active.map((rel) => statusPointer(rel, snapshot)),
      approval: thread.references.approval.map((rel) => statusPointer(rel, snapshot)),
      'recent-events': [...thread.recentEventSeqs],
      presentation: {
        fields: [
          { path: 'properties.identity', title: '目标', role: 'identity' },
          { path: 'properties.statusText', title: '状态', role: 'status' },
          { path: 'properties.resume', title: '上次停在哪', role: 'primary-content' },
          { path: 'properties.goal.source', title: '目标来源', role: 'metadata' },
        ],
      },
    },
    actions: declarations.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: referenceLinks(thread, snapshot, deps),
    'guard-results': unblocked(declarations),
    entities: contextMembers,
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
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, THREADS_REL), title: '我的工作线' }],
    'guard-results': unblocked([THREAD_CREATE_ACTION]),
    entities: threads.map((thread) => ({
      ...projectWorkThread(thread, snapshot, deps),
      rel: ['item'],
      href: entityHref(deps.baseHref, threadRel(thread.id)),
    })),
  };
}
