import { expect, test } from '@playwright/test';

test('T19 governance renderer discovers authoring specialization and keeps activation human-governed', async ({
  page,
  request,
}) => {
  const sitemapResponse = await request.get('/.well-known/ui4a.json');
  expect(sitemapResponse.ok()).toBe(true);
  const sitemap = (await sitemapResponse.json()) as {
    applications: {
      name: string;
      flows: { name: string; nodes: { name: string; actions: { name: string }[] }[] }[];
    }[];
    capabilities: {
      name: string;
      scope: { applications: string[]; flows: string[] };
      executor?: { class: string; profile: string; agentDefinition?: string };
    }[];
  };
  const governance = sitemap.applications.find(({ name }) => name === 'governance');
  const flow = governance?.flows.find(({ name }) => name === 'agent-definition-authoring');
  expect(flow).toBeDefined();
  const publicActions = flow?.nodes.flatMap((node) => node.actions.map(({ name }) => name));
  expect(publicActions).toEqual(
    expect.arrayContaining(['start-authoring', 'author-another', 'retry-authoring']),
  );
  expect(publicActions).not.toEqual(
    expect.arrayContaining(['authoring-succeeded', 'authoring-failed-callback', 'approve']),
  );
  expect(sitemap.capabilities.find(({ name }) => name === 'agent-definition.author')).toMatchObject(
    {
      scope: { applications: ['governance'], flows: ['agent-definition-authoring'] },
      executor: {
        class: 'agent-definition-authoring',
        profile: 'authoring-default',
        agentDefinition: 'agent-definition-author@1',
      },
    },
  );

  const entityResponse = await request.get('/api/entity?rel=agent-definition-request%3Amain', {
    headers: { 'x-ui4a-policy-scope': 'governance' },
  });
  expect(entityResponse.ok()).toBe(true);
  const entity = (await entityResponse.json()) as { actions: { name: string }[] };
  expect(entity.actions.map(({ name }) => name)).toEqual(['start-authoring']);

  const forged = await request.post('/api/exec', {
    headers: { 'x-ui4a-policy-scope': 'governance' },
    data: {
      rel: 'agent-definition-request:main',
      action: 'authoring-succeeded',
      actor: 'human',
      principal: 'local-user',
      params: { runId: 'forged', resultId: 'forged', draftRel: 'draft:forged' },
    },
  });
  expect(forged.status()).toBe(400);
  await expect(forged.json()).resolves.toMatchObject({ layer: 'undeclared' });

  await page.goto('/entity?rel=agent-definition-request%3Amain');
  await expect(page.getByLabel('专业 Agent 需求')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '生成 Agent Definition Draft', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Provider|endpoint|API Key|模型/)).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
