import {
  deriveSitemap,
  parseApplicationBundle,
  type ApplicationBundle,
  type Sitemap,
} from '@ui4a/engine';
import type { CognitiveSemanticsProjectionV1 } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { deriveAppWorkspaceComposition } from '../engine/presentation/app-workspace/composition';
import futureResearchArtifact from './test-fixtures/future-research.bundle.json';
import ideasArtifact from './ideas.bundle.json';
import todoArtifact from './todo.bundle.json';
import walkthroughArtifact from './ui4a-walkthrough.bundle.json';

const installedArtifacts = [walkthroughArtifact, todoArtifact, ideasArtifact] as const;
const installedBundles = installedArtifacts.map((artifact) => parseApplicationBundle(artifact));

function installedSitemap(): Sitemap {
  const applications = installedBundles.flatMap((bundle) => bundle.applications);
  return deriveSitemap(
    installedBundles.flatMap((bundle) => bundle.flows),
    {
      applications: Object.fromEntries(
        applications.map((application) => [application.name, application]),
      ),
      capabilities: Object.fromEntries(
        installedBundles
          .flatMap((bundle) => bundle.capabilities)
          .map((capability) => [capability.name, capability]),
      ),
    },
  );
}

interface StoryExpectation {
  name: string;
  title: string;
  entry: { target: string; role: 'primary-create' | 'primary-task' | 'primary-collection' };
  collection: string;
  collectionTitle: string;
  collectionTraits: readonly string[];
  emptyMeaning?: string;
  groupRole?: string;
  priority?: string;
  intentIncludes?: string;
  forbiddenSources?: readonly string[];
}

const storyMatrix: readonly StoryExpectation[] = [
  {
    name: 'publishing',
    title: '内容发布',
    entry: { target: 'flow:article-drafting', role: 'primary-create' },
    collection: 'articles',
    collectionTitle: '文章',
    collectionTraits: ['output-catalog'],
    forbiddenSources: ['agent-runs'],
  },
  {
    name: 'community',
    title: '社区互动',
    entry: { target: 'comments', role: 'primary-collection' },
    collection: 'comments',
    collectionTitle: '评论',
    collectionTraits: ['review-queue', 'human-responsibility'],
    emptyMeaning: 'no-current-responsibility',
    groupRole: 'responsibility',
    priority: 'high',
  },
  {
    name: 'development',
    title: '软件实施',
    entry: { target: 'flow:software-change', role: 'primary-task' },
    collection: 'software-changes',
    collectionTitle: '软件变更',
    collectionTraits: ['work-queue', 'task-history'],
    emptyMeaning: 'ready-to-start',
    forbiddenSources: ['agent-runs'],
  },
  {
    name: 'editorial',
    title: '编辑写作',
    entry: { target: 'flow:writing-request', role: 'primary-task' },
    collection: 'writing-requests',
    collectionTitle: '写作记录',
    collectionTraits: ['output-catalog', 'task-history'],
    emptyMeaning: 'ready-to-start',
    intentIncludes: '接受不等于发布',
  },
  {
    name: 'governance',
    title: 'Agent 治理',
    entry: { target: 'flow:agent-definition-authoring', role: 'primary-task' },
    collection: 'agent-definition-requests',
    collectionTitle: 'Agent 定义请求',
    collectionTraits: ['review-queue', 'human-responsibility'],
    emptyMeaning: 'ready-to-start',
    groupRole: 'responsibility',
  },
  {
    name: 'todo',
    title: '待办事项',
    entry: { target: 'flow:todo-capture', role: 'primary-create' },
    collection: 'todos',
    collectionTitle: '待办',
    collectionTraits: ['work-queue'],
    emptyMeaning: 'ready-to-start',
  },
  {
    name: 'ideas',
    title: '想法收集',
    entry: { target: 'flow:idea-capture', role: 'primary-create' },
    collection: 'ideas',
    collectionTitle: '想法',
    collectionTraits: ['work-queue'],
    emptyMeaning: 'ready-to-start',
  },
];

function missingCognition(
  presentation: CognitiveSemanticsProjectionV1 | undefined,
  expected: StoryExpectation,
): string[] {
  const problems: string[] = [];
  for (const trait of expected.collectionTraits) {
    if (presentation?.traits?.includes(trait as never) !== true) problems.push(`trait:${trait}`);
  }
  if (expected.emptyMeaning !== undefined && presentation?.emptyMeaning !== expected.emptyMeaning) {
    problems.push(`emptyMeaning:${expected.emptyMeaning}`);
  }
  if (expected.groupRole !== undefined && presentation?.groupRole !== expected.groupRole) {
    problems.push(`groupRole:${expected.groupRole}`);
  }
  if (expected.priority !== undefined && presentation?.priority !== expected.priority) {
    problems.push(`priority:${expected.priority}`);
  }
  return problems;
}

function forbiddenVisualKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((member, index) => forbiddenVisualKeys(member, `${path}[${index}]`));
  }
  if (typeof value !== 'object' || value === null) return [];
  const forbidden = new Set(['layout', 'device', 'css', 'component', 'density', 'sticky']);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, member]) => [
    ...(forbidden.has(key.toLowerCase()) ? [`${path}.${key}`] : []),
    ...forbiddenVisualKeys(member, `${path}.${key}`),
  ]);
}

describe('T39 US11-US17 installed Application declaration stories (G11 Red)', () => {
  const sitemap = installedSitemap();

  it('keeps default as a system-only ownership floor with no normal landing or business role', () => {
    const defaultApplication = sitemap.applications.find(({ name }) => name === 'default');
    expect(defaultApplication).toMatchObject({
      title: '默认应用',
      presentation: { version: 1, traits: ['system-fallback'] },
    });
    expect(defaultApplication?.entry).toBeUndefined();
    expect(sitemap.surfaces.some(({ rel }) => rel === 'application:default')).toBe(false);
    expect(deriveAppWorkspaceComposition('default', sitemap)).toBeUndefined();
  });

  it.each(storyMatrix)(
    '$name derives its entry, owned collection and cognitive posture',
    (story) => {
      const application = sitemap.applications.find(({ name }) => name === story.name);
      const collection = sitemap.surfaces.find(({ rel }) => rel === story.collection);
      const composition = deriveAppWorkspaceComposition(story.name, sitemap);
      const sources = composition?.regions.map(({ source }) => source) ?? [];
      const problems: string[] = [];

      if (application?.title !== story.title) problems.push(`title:${story.title}`);
      if (application?.intent.trim() === '') problems.push('intent:non-empty');
      if (JSON.stringify(application?.entry) !== JSON.stringify(story.entry)) {
        problems.push(`entry:${JSON.stringify(story.entry)}`);
      }
      if (
        story.intentIncludes !== undefined &&
        !application?.intent.includes(story.intentIncludes)
      ) {
        problems.push(`intent:${story.intentIncludes}`);
      }
      if (collection?.app !== story.name) problems.push(`collection-owner:${story.name}`);
      if (collection?.title !== story.collectionTitle) {
        problems.push(`collection-title:${story.collectionTitle}`);
      }
      problems.push(...missingCognition(collection?.presentation, story));
      if (!sources.includes(`application:${story.name}`)) problems.push('application-header');
      if (!sources.includes(story.entry.target))
        problems.push(`entry-source:${story.entry.target}`);
      if (!sources.includes(story.collection))
        problems.push(`collection-source:${story.collection}`);
      for (const source of story.forbiddenSources ?? []) {
        if (sources.includes(source)) problems.push(`forbidden-source:${source}`);
      }

      expect(problems).toEqual([]);
    },
  );

  it('community declares review facts from the comment Flow rather than a Renderer/default guess', () => {
    const comments = installedBundles
      .flatMap((bundle) => bundle.flows)
      .find(({ name }) => name === 'comment-moderation');
    const body = comments?.fields?.find(({ name }) => name === 'body');
    const status = comments?.fields?.find(({ name }) => name === 'status');

    expect(comments?.app).toBe('community');
    expect(comments?.collections?.map(({ collection }) => collection)).toContain('comments');
    expect(body?.presentation).toMatchObject({ role: 'primary-content', overview: true });
    expect(status?.presentation).toMatchObject({ role: 'status', overview: true });
  });

  it('all eight definitions keep visual policy out of Application/Flow declaration data', () => {
    expect(
      forbiddenVisualKeys(
        installedBundles.flatMap((bundle) => [bundle.applications, bundle.flows]),
      ),
    ).toEqual([]);
    expect(sitemap.applications.map(({ name }) => name)).toEqual([
      'default',
      'publishing',
      'community',
      'development',
      'editorial',
      'governance',
      'todo',
      'ideas',
    ]);
  });
});

describe('future ninth Application fixture uses the same generic contract', () => {
  it('parses and derives a landing, entry, queue and empty meaning from definition data only', () => {
    const future = parseApplicationBundle(futureResearchArtifact) as ApplicationBundle;
    const application = future.applications[0]!;
    const sitemap = deriveSitemap(future.flows, {
      applications: { [application.name]: application },
    });
    const composition = deriveAppWorkspaceComposition(application.name, sitemap);

    expect(composition?.regions.map(({ source }) => source)).toEqual([
      'application:research',
      'research-items',
      'flow:research-capture',
    ]);
    expect(
      sitemap.surfaces.find(({ rel }) => rel === 'research-items')?.presentation,
    ).toMatchObject({
      traits: ['work-queue'],
      emptyMeaning: 'ready-to-start',
    });
    expect(sitemap.surfaces.find(({ rel }) => rel === 'research-items')?.title).toBe('待验证线索');
    expect(
      installedBundles.flatMap((bundle) => bundle.applications).map(({ name }) => name),
    ).not.toContain('research');
  });
});
