import { expect, test } from '@playwright/test';

test('T19 editorial renderer discovers Writing specialization and exposes only governed actions', async ({
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
  const editorial = sitemap.applications.find(({ name }) => name === 'editorial');
  expect(editorial?.flows.map(({ name }) => name)).toContain('writing-request');
  const writingFlow = editorial?.flows.find(({ name }) => name === 'writing-request');
  const actions = writingFlow?.nodes.flatMap((node) => node.actions.map((action) => action.name));
  expect(actions).toEqual(
    expect.arrayContaining([
      'start-writing',
      'accept-writing-result',
      'reject-writing-result',
      'retry-writing',
    ]),
  );
  expect(actions).not.toEqual(
    expect.arrayContaining(['writing-succeeded', 'writing-failed-callback']),
  );
  const writing = sitemap.capabilities.find(({ name }) => name === 'writing.compose');
  expect(writing).toMatchObject({
    scope: { applications: ['editorial'], flows: ['writing-request'] },
    executor: {
      class: 'document-agent',
      profile: 'editorial-default',
      agentDefinition: 'writing-agent@1',
    },
  });
  expect(JSON.stringify(writing)).not.toMatch(/provider|endpoint|apiKey|model/i);

  const entityResponse = await request.get('/api/entity?rel=writing-request%3Amain', {
    headers: { 'x-ui4a-policy-scope': 'editorial' },
  });
  expect(entityResponse.ok()).toBe(true);
  const entity = (await entityResponse.json()) as { actions: { name: string }[] };
  expect(entity.actions.map(({ name }) => name)).toEqual(['start-writing']);

  const fuzzed = await request.post('/api/exec', {
    headers: { 'x-ui4a-policy-scope': 'editorial' },
    data: {
      rel: 'writing-request:main',
      action: 'writing-succeeded',
      actor: 'human',
      principal: 'local-user',
      params: { runId: 'forged', resultId: 'forged' },
    },
  });
  expect(fuzzed.status()).toBe(400);
  await expect(fuzzed.json()).resolves.toMatchObject({ layer: 'undeclared' });

  const overridden = await request.post('/api/exec', {
    headers: { 'x-ui4a-policy-scope': 'editorial' },
    data: {
      rel: 'writing-request:main',
      action: 'start-writing',
      actor: 'human',
      principal: 'local-user',
      params: {
        objective: 'Write a grounded note.',
        audience: 'engineers',
        requiredSections: ['Summary'],
        constraints: [],
        sources: [
          {
            id: 'S1',
            title: 'Source',
            mediaType: 'text/plain',
            content: 'Fact.',
            hash: `sha256:${'a'.repeat(64)}`,
          },
        ],
        model: 'request-model',
        runtimeProfile: 'request-profile',
        allowedOutputPaths: ['/tmp/outside.md'],
      },
    },
  });
  expect(overridden.status()).toBe(422);
  await expect(overridden.json()).resolves.toMatchObject({ layer: 'schema-invalid' });

  await page.goto('/entity?rel=writing-request%3Amain');
  await expect(page.getByText('待提交 Brief', { exact: true })).toBeVisible();
  await expect(page.getByLabel('写作目标')).toBeVisible();
  await expect(page.getByLabel('目标读者')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始写作', exact: true })).toBeVisible();
  await expect(page.getByText(/Provider|endpoint|API Key|模型/)).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
