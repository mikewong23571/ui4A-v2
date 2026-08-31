import { describe, expect, it } from 'vitest';

import { runAgent } from '../loop/loop';
import { ScriptedDriver, contractTransport, BASE } from '../loop/loop-test-fixtures';
import { collectionEntity, instanceEntity } from '../testkit/testkit';
import { buildUserPrompt } from '../llm/prompts';
import type { SitemapSummary } from '../types';

const sitemap: SitemapSummary = {
  version: 'fresh',
  surfaces: [
    { rel: 'applications', title: '应用' },
    { rel: 'alpha-home', title: '甲入口', app: 'alpha' },
    { rel: 'beta-home', title: '乙入口', app: 'beta' },
  ],
  applications: ['alpha', 'beta'].map((name) => ({
    name,
    title: `${name}标题`,
    intent: `${name}用途`,
    entry: { role: 'primary-collection', target: `${name}-home` },
    flows: [
      {
        name: `${name}-flow`,
        title: `${name}流程`,
        actions: [{ name: `${name}-finish`, title: '完成', node: 'open', guards: [] }],
      },
    ],
  })),
};

describe('shared work context in the Agent loop', () => {
  it.each([true, false])(
    'refreshes grants after the preloaded first decision (refresh succeeds: %s)',
    async (available) => {
      let sitemapReads = 0;
      const driver = new ScriptedDriver([
        { kind: 'navigate', rel: 'beta-home' },
        { kind: 'answer', content: '当前可访问范围', sources: [] },
      ]);
      const fetchImpl = async (url: string) => {
        if (url.endsWith('/.well-known/ui4a.json')) {
          sitemapReads += 1;
          return available
            ? Response.json({
                ...sitemap,
                surfaces: sitemap.surfaces.filter(({ app }) => app !== 'alpha'),
                applications: sitemap.applications.filter(({ name }) => name !== 'alpha'),
              })
            : Response.json({ error: 'unavailable' }, { status: 403 });
        }
        const rel = new URL(url).searchParams.get('rel')!;
        return Response.json(instanceEntity({ rel, flow: 'beta-flow', node: 'open' }));
      };
      await runAgent(
        driver,
        { verb: '查看当前合同' },
        { baseUrl: BASE, fetchImpl, sitemap, startRel: 'alpha-home' },
      );
      expect(sitemapReads).toBe(1);
      expect(driver.contexts[0]?.sitemap?.applications.map(({ name }) => name)).toEqual([
        'alpha',
        'beta',
      ]);
      expect(driver.contexts[1]?.sitemap?.applications.map(({ name }) => name)).toEqual(
        available ? ['beta'] : undefined,
      );
      expect(buildUserPrompt(driver.contexts[1]!)).not.toContain('alpha标题');
    },
  );

  it('starts from authorized applications without implicitly selecting an application', async () => {
    const driver = new ScriptedDriver([{ kind: 'answer', content: '应用目录', sources: [] }]);
    const transport = contractTransport({
      entities: { applications: collectionEntity({ rel: 'applications', members: [] }) },
      sitemap,
    });
    await runAgent(driver, { verb: '有哪些能力' }, { baseUrl: BASE, fetchImpl: transport.fetch });
    const context = driver.contexts[0]!;
    expect(context.currentRel).toBe('applications');
    expect(context.app).toBeUndefined();
    expect(context.observedApplication).toBeUndefined();
    expect(context.sitemap?.applications.map(({ name }) => name)).toEqual(['alpha', 'beta']);
    expect(transport.calls.some(({ url }) => url.includes('rel=articles'))).toBe(false);
    expect(buildUserPrompt(context)).toContain('alpha标题');
    expect(buildUserPrompt(context)).toContain('alpha-home');
  });

  it('navigation changes disclosed details, never the explicit application preference', async () => {
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'beta-home' },
      { kind: 'answer', content: '乙详情', sources: [] },
    ]);
    const transport = contractTransport({
      entities: {
        'alpha-home': instanceEntity({ rel: 'alpha-home', flow: 'alpha-flow', node: 'open' }),
        'beta-home': instanceEntity({ rel: 'beta-home', flow: 'beta-flow', node: 'open' }),
      },
      sitemap,
    });
    await runAgent(
      driver,
      { verb: '查看另一个应用' },
      { baseUrl: BASE, fetchImpl: transport.fetch, startRel: 'alpha-home', app: 'alpha' },
    );
    const context = driver.contexts[1]!;
    expect(context.app).toBe('alpha');
    expect(context.observedApplication).toBe('beta');
    expect(context.sitemap?.applications.map(({ name }) => name)).toEqual(['alpha', 'beta']);
    const prompt = buildUserPrompt(context);
    expect(prompt).toContain('beta-finish');
    expect(prompt).not.toContain('alpha-finish');
  });

  it('keeps a fixed thread reference and refreshes its facts after navigation', async () => {
    let revision = 0;
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'beta-home' },
      { kind: 'answer', content: '工作进度', sources: [] },
    ]);
    const transport = async (url: string) => {
      const rel = new URL(url).searchParams.get('rel');
      if (rel === 'thread:release') {
        revision += 1;
        return Response.json({
          class: ['work-thread'],
          properties: { rel, identity: `公告-${revision}` },
          actions: [],
          links: [{ rel: ['active'], href: '/api/entity?rel=work%3Aone' }],
        });
      }
      return Response.json(instanceEntity({ rel: rel!, flow: 'beta-flow', node: 'open' }));
    };
    await runAgent(
      driver,
      { verb: '还有哪些工作' },
      {
        baseUrl: BASE,
        fetchImpl: transport,
        sitemap,
        startRel: 'alpha-home',
        contextRel: 'thread:release',
      },
    );
    expect(driver.contexts[0]?.workingContext?.entity?.properties.identity).toBe('公告-1');
    expect(driver.contexts[1]?.workingContext?.entity?.properties.identity).toBe('公告-2');
    expect(driver.contexts[1]?.workingContext?.observations[0]?.rel).toBe('work:one');
  });
});
