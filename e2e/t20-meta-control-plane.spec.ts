import { expect, test, type Page, type TestInfo } from '@playwright/test';

type MetaRequestSample = { url: string; method: string };

function observeMetaRequests(page: Page): MetaRequestSample[] {
  const samples: MetaRequestSample[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/_meta/')) {
      samples.push({ url: `${url.pathname}${url.search}`, method: request.method() });
    }
  });
  return samples;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.describe.serial('T20 Meta Human Control Plane', () => {
  test('dynamic dashboard discovers seven authorized faces and restores scope', async ({
    page,
  }, testInfo) => {
    const requests = observeMetaRequests(page);
    await page.goto('/meta?scope=governance');
    await expect(page.getByTestId('meta-content-ready')).toBeVisible();
    await expect(page.getByRole('heading', { name: '定义控制台' })).toBeVisible();
    await expect(page.getByTestId('meta-surface')).toHaveCount(7);
    await expect(page.getByLabel('当前 Scope')).toHaveValue('governance');
    await expect(page.getByText(/本地演示身份/)).toBeVisible();
    await expect(page.getByRole('option', { name: 'root-admin' })).toHaveCount(0);
    await expect
      .poll(() => requests.filter((item) => item.url.includes('.well-known')).length)
      .toBe(1);
    expect(requests.filter((item) => item.url.includes('/api/entity')).length).toBe(6);

    await page.getByRole('searchbox').fill('publishing');
    await expect(page.getByRole('link', { name: /内容发布/ })).toBeVisible();
    await screenshot(page, testInfo, 'dashboard-desktop-1440x900');
  });

  test('Application orientation is task-first, read-only, linked and bounded to two requests', async ({
    page,
  }, testInfo) => {
    const requests = observeMetaRequests(page);
    await page.goto('/meta/entity?rel=meta%2Fapplication%3Apublishing&scope=publishing');
    await expect(page.getByTestId('meta-content-ready')).toBeVisible();
    await expect(page.getByRole('heading', { name: '内容发布' })).toBeVisible();
    await expect(page.locator('header').getByText(/内容起草与发布/)).toBeVisible();
    await expect(page.getByText(/只读/)).toBeVisible();
    await expect(page.getByRole('link', { name: /文章状态/ })).toHaveAttribute(
      'href',
      /meta%2Fflow%3Apost-status/,
    );
    await expect(page.getByText('原始合同')).toBeVisible();
    expect(requests.filter((item) => item.url.includes('/api/entity')).length).toBe(1);
    expect(requests.filter((item) => item.url.includes('.well-known')).length).toBe(1);
    await screenshot(page, testInfo, 'application-desktop-1440x900');
  });

  test('Agent Definition explains authority, binding, runtime and birth links without secrets', async ({
    page,
  }, testInfo) => {
    await page.goto(
      '/meta/entity?rel=meta%2Fagent-definition%3Aagent-definition-author%401&scope=governance',
    );
    await expect(page.getByTestId('meta-content-ready')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'agent-definition-author@1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '封闭权威' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '数据绑定' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '部署要求' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'runs' })).toHaveAttribute(
      'href',
      /agent-runs.*scope=governance/,
    );
    await expect(page.getByText(/Provider profile 与 credential/)).toBeVisible();
    await expect(page.getByText(/sk-[A-Za-z0-9]{8}|apiKey|LLM_API_KEY/)).toHaveCount(0);
    await screenshot(page, testInfo, 'agent-definition-desktop-1440x900');
    await page.getByRole('link', { name: 'runs' }).click();
    await expect(page).toHaveURL(/\/entity\?rel=agent-runs&scope=governance/);
    await expect(page.getByRole('heading', { name: 'agent-runs' })).toBeVisible();
  });

  test('future surface uses safe generic renderer without dashboard branches', async ({ page }) => {
    const baseSitemap = {
      protocolVersion: '1',
      version: 'fixture-v1',
      site: 'meta',
      effectiveScope: 'governance',
      authorizedScopes: ['governance'],
      authorizationMode: 'self-reported-local-demo',
      surfaces: [
        { rel: 'meta/widgets', title: 'Future Widgets', collection: true },
        { rel: 'draft:fixture', title: 'Writer candidate' },
      ],
    };
    await page.route('**/_meta/.well-known/ui4a.json**', async (route) => {
      await route.fulfill({ json: baseSitemap });
    });
    await page.route('**/_meta/api/entity?**', async (route) => {
      const rel = new URL(route.request().url()).searchParams.get('rel');
      if (rel === 'meta/widgets') {
        await route.fulfill({
          json: {
            class: ['collection', 'meta/widgets'],
            properties: { rel, count: 1 },
            actions: [],
            links: [],
            'guard-results': [],
            entities: [
              {
                class: ['meta', 'widget'],
                rel: ['item'],
                properties: { title: 'Widget One', status: 'active' },
                actions: [],
                links: [],
                'guard-results': [],
              },
            ],
          },
        });
        return;
      }
      await route.fulfill({ status: 404, json: { error: 'not found' } });
    });

    await page.goto('/meta?scope=governance');
    await expect(page.getByRole('link', { name: /Future Widgets/ })).toBeVisible();
    await page.getByRole('link', { name: /Future Widgets/ }).click();
    await expect(page.getByText(/通用合同视图/)).toBeVisible();
    await expect(page.getByRole('region', { name: '成员' }).getByText('Widget One')).toBeVisible();
    await expect(page.locator('[data-action]')).toHaveCount(0);
  });

  test('invalid Draft workbench prioritizes blockers, checks and evidence', async ({
    page,
  }, testInfo) => {
    let revised = false;
    await page.route('**/_meta/.well-known/ui4a.json**', async (route) => {
      await route.fulfill({
        json: {
          protocolVersion: '1',
          version: 'draft-fixture-v1',
          site: 'meta',
          effectiveScope: 'governance',
          authorizedScopes: ['governance'],
          authorizationMode: 'self-reported-local-demo',
          surfaces: [{ rel: 'draft:fixture', title: 'Writer candidate' }],
        },
      });
    });
    await page.route('**/_meta/api/entity?**', async (route) => {
      await route.fulfill({
        json: {
          class: ['meta', 'draft', 'agent-definition', revised ? 'ready' : 'invalid'],
          properties: {
            rel: 'draft:fixture',
            id: 'fixture',
            owner: 'local-user',
            policyScope: 'governance',
            kind: 'agent-definition',
            target: 'writer',
            status: revised ? 'ready' : 'invalid',
            version: revised ? 2 : 1,
            maxVersion: revised ? 2 : 1,
            validation: {
              valid: revised,
              issues: revised
                ? []
                : [
                    {
                      code: 'eval-required',
                      path: '/evaluationPolicy',
                      message: 'Eval required',
                    },
                  ],
            },
            checks: [
              revised
                ? { name: 'eval', pass: true }
                : { name: 'eval', pass: false, detail: ['missing evidence'] },
            ],
            evaluation: revised
              ? { refs: ['eval:writer'], missing: [] }
              : { refs: ['eval:writer'], missing: ['eval:writer'] },
            provenance: { actor: 'agent', principal: 'local-user', sources: ['agent-run:r1'] },
            payload: revised
              ? {
                  schemaVersion: 1,
                  name: 'writer',
                  version: 1,
                  intent: 'Needs evaluation policy',
                  evaluationPolicy: { minimumScore: 0.8 },
                }
              : {
                  schemaVersion: 1,
                  name: 'writer',
                  version: 1,
                  intent: 'Needs evaluation policy',
                },
          },
          actions: [
            {
              name: 'revise',
              title: 'Revise',
              method: 'POST',
              href: '/_meta/api/exec',
              fields: {
                type: 'object',
                properties: {
                  commandId: { type: 'string' },
                  baseVersion: { type: 'number' },
                  payload: {},
                },
                required: ['commandId', 'baseVersion', 'payload'],
                additionalProperties: false,
              },
            },
          ],
          links: [],
          'guard-results': [],
        },
      });
    });
    await page.route('**/_meta/api/exec**', async (route) => {
      const body = route.request().postDataJSON() as {
        rel: string;
        action: string;
        params: { baseVersion: number; payload: unknown };
      };
      expect(body).toMatchObject({
        rel: 'draft:fixture',
        action: 'revise',
        params: {
          baseVersion: 1,
          payload: {
            name: 'writer',
            evaluationPolicy: { minimumScore: 0.8 },
          },
        },
      });
      revised = true;
      await route.fulfill({ json: { entity: { properties: { status: 'ready' } } } });
    });
    await page.goto('/meta/entity?rel=draft%3Afixture&scope=governance');
    await expect(page.getByText('1 个阻塞问题')).toBeVisible();
    await expect(page.getByRole('alert').getByText('Eval required')).toBeVisible();
    await expect(page.getByText('FAIL', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Minimum score')).toBeVisible();
    await screenshot(page, testInfo, 'invalid-draft-desktop-1440x900');
    await page.getByLabel('Minimum score').fill('0.8');
    await page.getByRole('button', { name: '保存修订' }).click();
    await expect.poll(() => revised).toBe(true);
    await expect(page.getByText('ready', { exact: true })).toBeVisible();
  });

  test('pending Draft decision is keyboard-completable and current-action backed', async ({
    page,
  }) => {
    let executed = false;
    const activation = {
      class: ['meta', 'activation', 'pending-approval'],
      properties: {
        rel: 'meta/activation:draft:pending',
        version: 1,
        status: 'pending-approval',
      },
      actions: [
        {
          name: 'approve',
          title: 'Approve',
          method: 'POST',
          href: '/_meta/api/exec',
          fields: {
            type: 'object',
            properties: { commandId: { type: 'string', minLength: 1 } },
            required: ['commandId'],
            additionalProperties: false,
          },
        },
      ],
      links: [],
      'guard-results': [
        {
          action: 'approve',
          blocked: true,
          reason: 'actor-is-human is evaluated from authenticated request context',
          guards: [{ name: 'actor-is-human', pass: false }],
        },
      ],
    };
    await page.route('**/_meta/.well-known/ui4a.json**', async (route) => {
      await route.fulfill({
        json: {
          protocolVersion: '1',
          version: 'pending-v1',
          site: 'meta',
          effectiveScope: 'governance',
          authorizedScopes: ['governance'],
          authorizationMode: 'self-reported-local-demo',
          surfaces: [{ rel: 'draft:pending', title: 'Pending writer' }],
        },
      });
    });
    await page.route('**/_meta/api/entity?**', async (route) => {
      const rel = new URL(route.request().url()).searchParams.get('rel');
      if (rel === 'meta/activation:draft:pending') {
        await route.fulfill({
          json: executed
            ? {
                ...activation,
                class: ['meta', 'activation', 'accepted'],
                properties: { ...activation.properties, status: 'accepted' },
                actions: [],
                'guard-results': [],
              }
            : activation,
        });
        return;
      }
      await route.fulfill({
        json: {
          class: ['meta', 'draft', 'agent-definition', executed ? 'accepted' : 'pending-approval'],
          properties: {
            rel: 'draft:pending',
            id: 'pending',
            owner: 'local-user',
            policyScope: 'governance',
            kind: 'agent-definition',
            target: 'writer',
            status: executed ? 'accepted' : 'pending-approval',
            version: 1,
            maxVersion: 1,
            validation: { valid: true, issues: [] },
            checks: [{ name: 'eval', pass: true }],
            activation: 'meta/activation:draft:pending',
          },
          actions: [],
          links: [],
          'guard-results': [],
        },
      });
    });
    await page.route('**/_meta/api/exec**', async (route) => {
      const body = route.request().postDataJSON() as { rel: string; action: string };
      expect(body).toMatchObject({ rel: 'meta/activation:draft:pending', action: 'approve' });
      expect(body).not.toHaveProperty('actor');
      expect(body).not.toHaveProperty('principal');
      executed = true;
      await route.fulfill({ json: { entity: { ...activation, actions: [] } } });
    });

    await page.goto('/meta/entity?rel=draft%3Apending&scope=governance');
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
    const declared = await page
      .locator('[data-action]')
      .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute('data-action')))]);
    expect(declared).toEqual(['approve']);

    for (let index = 0; index < 40; index += 1) {
      if (
        (await page.evaluate(() => document.activeElement?.getAttribute('data-action'))) ===
        'approve'
      ) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-action'))).toBe(
      'approve',
    );
    await page.keyboard.press('Enter');
    await expect.poll(() => executed).toBe(true);
    await expect(page.getByText('accepted', { exact: true })).toBeVisible();
  });

  test('scope forgery fails and mobile pages have no page-level overflow', async ({
    page,
    request,
  }, testInfo) => {
    const forged = await request.get('/_meta/.well-known/ui4a.json?scope=root-admin');
    expect(forged.status()).toBe(403);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, route] of [
      ['dashboard-mobile-390x844', '/meta?scope=governance'],
      [
        'application-mobile-390x844',
        '/meta/entity?rel=meta%2Fapplication%3Apublishing&scope=publishing',
      ],
      [
        'agent-definition-mobile-390x844',
        '/meta/entity?rel=meta%2Fagent-definition%3Aagent-definition-author%401&scope=governance',
      ],
    ] as const) {
      await page.goto(route);
      await expect(page.getByTestId('meta-content-ready')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await screenshot(page, testInfo, name);
    }
  });

  test('warm local primary-content p95 stays under one second', async ({ page }, testInfo) => {
    const samples: number[] = [];
    for (let iteration = 0; iteration < 3; iteration += 1) {
      await page.goto('/meta?scope=publishing');
      await expect(page.getByTestId('meta-content-ready')).toBeVisible();
    }
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const started = performance.now();
      await page.goto('/meta/entity?rel=meta%2Fapplication%3Apublishing&scope=publishing');
      await expect(page.getByTestId('meta-content-ready')).toBeVisible();
      samples.push(Math.round(performance.now() - started));
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p50 = sorted[Math.ceil(sorted.length * 0.5) - 1]!;
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    await testInfo.attach('meta-performance.json', {
      body: JSON.stringify({ samples, p50, p95, unit: 'ms' }, null, 2),
      contentType: 'application/json',
    });
    expect(p95).toBeLessThan(1_000);
  });
});
