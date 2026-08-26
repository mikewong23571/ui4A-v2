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
  title: 'Create work thread',
  ...noNodeFields,
  fields: [
    { name: 'id', type: 'text', title: 'Thread id', required: true, minLength: 1 },
    { name: 'goal', type: 'textarea', title: 'Goal', required: true, minLength: 1 },
    {
      name: 'goalSource',
      type: 'text',
      title: 'Goal source',
      required: true,
      minLength: 1,
    },
  ],
};

const referenceFields: ActionDefinition['fields'] = [
  {
    name: 'category',
    type: 'select',
    title: 'Category',
    required: true,
    options: [...THREAD_REFERENCE_CATEGORIES],
  },
  { name: 'rel', type: 'text', title: 'Reference', required: true, minLength: 1 },
];

export const THREAD_ATTACH_ACTION: ActionDefinition = {
  name: 'attach',
  title: 'Attach reference',
  ...noNodeFields,
  fields: referenceFields,
};

export const THREAD_DETACH_ACTION: ActionDefinition = {
  name: 'detach',
  title: 'Detach reference',
  ...noNodeFields,
  fields: referenceFields,
};

export const THREAD_PAUSE_ACTION: ActionDefinition = {
  name: 'pause',
  title: 'Pause work thread',
  ...noNodeFields,
};

export const THREAD_RESUME_ACTION: ActionDefinition = {
  name: 'resume',
  title: 'Resume work thread',
  ...noNodeFields,
};

export const THREAD_COMPLETE_ACTION: ActionDefinition = {
  name: 'complete',
  title: 'Complete work thread',
  ...noNodeFields,
};

export const THREAD_ARCHIVE_ACTION: ActionDefinition = {
  name: 'archive',
  title: 'Archive work thread',
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
  for (const rel of thread.references.context) {
    links.push({ rel: ['context'], href: entityHref(deps.baseHref, rel) });
  }
  for (const category of ['active', 'approval'] as const) {
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

export function projectWorkThread(
  thread: ThreadSnapshot,
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
): SirenEntity {
  const declarations = threadActionsForStatus(thread.status);
  return {
    class: ['work-thread', thread.status],
    properties: {
      id: thread.id,
      owner: thread.owner,
      goal: thread.goal,
      status: thread.status,
      context: [...thread.references.context],
      active: thread.references.active.map((rel) => statusPointer(rel, snapshot)),
      approval: thread.references.approval.map((rel) => statusPointer(rel, snapshot)),
      'recent-events': [...thread.recentEventSeqs],
    },
    actions: declarations.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: referenceLinks(thread, snapshot, deps),
    'guard-results': unblocked(declarations),
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
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, THREADS_REL) }],
    'guard-results': unblocked([THREAD_CREATE_ACTION]),
    entities: threads.map((thread) => ({
      ...projectWorkThread(thread, snapshot, deps),
      rel: ['item'],
      href: entityHref(deps.baseHref, threadRel(thread.id)),
    })),
  };
}
