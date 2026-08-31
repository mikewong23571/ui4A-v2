import { Buffer } from 'node:buffer';

import {
  buildSystemPrompt,
  createContractClient,
  createLlmDriver,
  sliceSitemapDisclosure,
  type DriverContext,
  type FetchLike,
  type SitemapSummary,
} from '@ui4a/agent';
import {
  deriveSitemap,
  fold,
  parseApplicationBundle,
  project,
  type SirenEntity,
} from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';
import { describe, expect, it } from 'vitest';

import { resolveStartRel } from '../chat/start-chain';
import { assembleSituation } from '../engine/situation';
import artifact from './ui4a-walkthrough.bundle.json';

const DECIDE_WIRE_BUDGET_BYTES = 32 * 1024;
const OLD_OBSERVATION_MARKER = 'OLD_OBSERVATION_MUST_NOT_REACH_PROVIDER';
const RAW_ENTITY_MARKER = 'RAW_ENTITY_PAYLOAD_MUST_NOT_REACH_PROVIDER';
const VISUAL_MARKERS = {
  css: 'CSS_POLICY_MUST_NOT_REACH_PROVIDER',
  layout: 'LAYOUT_POLICY_MUST_NOT_REACH_PROVIDER',
  device: 'DEVICE_POLICY_MUST_NOT_REACH_PROVIDER',
  sticky: 'STICKY_POLICY_MUST_NOT_REACH_PROVIDER',
  density: 'DENSITY_POLICY_MUST_NOT_REACH_PROVIDER',
  component: 'COMPONENT_POLICY_MUST_NOT_REACH_PROVIDER',
  sidecar: 'SIDECAR_PAYLOAD_MUST_NOT_REACH_PROVIDER',
  surface: 'SURFACE_PAYLOAD_MUST_NOT_REACH_PROVIDER',
  bindings: 'BINDINGS_PAYLOAD_MUST_NOT_REACH_PROVIDER',
} as const;

const bundle = parseApplicationBundle(artifact);
const flows = Object.fromEntries(bundle.flows.map((flow) => [flow.name, flow]));
const applications = Object.fromEntries(
  bundle.applications.map((application) => [application.name, application]),
);

function baseSnapshot(): EngineSnapshot {
  const seeded = fold(
    [{ seq: 1, kind: 'seed', rel: bundle.seed.rel, detail: bundle.seed.detail }],
    { flows },
  );
  return {
    ...seeded,
    applications,
    capabilities: Object.fromEntries(
      bundle.capabilities.map((capability) => [capability.name, capability]),
    ),
  };
}

async function sitemapFromRealWire(): Promise<SitemapSummary> {
  const sitemap = deriveSitemap(bundle.flows, {
    applications,
    capabilities: Object.fromEntries(
      bundle.capabilities.map((capability) => [capability.name, capability]),
    ),
  });
  const client = createContractClient('http://contract.test', async () => Response.json(sitemap));
  const summary = await client.getSitemap();
  if (summary === undefined) throw new Error('walkthrough sitemap was not parsed from the wire');
  return summary;
}

function sseAnswer(source: { rel: string; pointer: string }): Response {
  const chunks = [
    {
      id: 'chatcmpl-t39-parity',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_t39_parity',
                type: 'function',
                function: {
                  name: 'answer',
                  arguments: JSON.stringify({ content: '已按当前合同读取。', sources: [source] }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-t39-parity',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function providerDecision(
  context: DriverContext,
  source: { rel: string; pointer: string },
): Promise<{
  rawBody: string;
  operation: Awaited<ReturnType<ReturnType<typeof createLlmDriver>['decide']>>;
}> {
  let rawBody: string | undefined;
  const fetchImpl: FetchLike = async (_url, init) => {
    if (rawBody !== undefined) throw new Error('expected exactly one provider request');
    if (typeof init?.body !== 'string') throw new Error('provider request body must be a string');
    rawBody = init.body;
    return sseAnswer(source);
  };
  const driver = createLlmDriver({
    apiKey: 'test-key',
    baseURL: 'https://provider.test/v1',
    model: 'test-model',
    fetchImpl,
  });
  const operation = await driver.decide(context);
  if (rawBody === undefined) throw new Error('provider request was not captured');
  return { rawBody, operation };
}

function withProviderExcludedPayload(entity: SirenEntity): SirenEntity {
  const exact = structuredClone(entity);
  exact.properties.rawPayload = RAW_ENTITY_MARKER;
  exact.properties.presentation = {
    ...((exact.properties.presentation as Record<string, unknown> | undefined) ?? {}),
    css: VISUAL_MARKERS.css,
    layout: VISUAL_MARKERS.layout,
    device: VISUAL_MARKERS.device,
    sticky: VISUAL_MARKERS.sticky,
    density: VISUAL_MARKERS.density,
    component: VISUAL_MARKERS.component,
    sidecar: { marker: VISUAL_MARKERS.sidecar },
    surface: { marker: VISUAL_MARKERS.surface },
    bindings: [{ marker: VISUAL_MARKERS.bindings }],
  };
  return exact;
}

function oldObservation(): SirenEntity {
  return {
    class: ['flow-instance', 'old-flow'],
    properties: {
      rel: 'old:observation',
      flow: 'old-flow',
      node: 'old',
      fields: { body: OLD_OBSERVATION_MARKER },
      presentation: {
        fields: [
          {
            path: 'properties.fields.body',
            title: '旧正文',
            role: 'primary-content',
          },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=old:observation' }],
    'guard-results': [],
  };
}

function pointerValue(root: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, token) => {
      if (typeof value !== 'object' || value === null) return undefined;
      return (value as Record<string, unknown>)[token];
    }, root);
}

function section(content: string, heading: string, nextHeading: string): Record<string, unknown> {
  const start = content.indexOf(heading);
  const end = content.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) throw new Error(`missing prompt section ${heading}`);
  const payload = content.slice(start + heading.length, end).trim();
  const jsonStart = payload.indexOf('{');
  if (jsonStart < 0) throw new Error(`prompt section ${heading} does not contain JSON`);
  return JSON.parse(payload.slice(jsonStart)) as Record<string, unknown>;
}

interface Scenario {
  app: 'publishing' | 'community' | 'governance';
  currentRel: string;
  attention: 'explicit' | 'presence';
  expectedActions: string[];
  fact: { pointer: string; value: unknown };
}

const scenarios: readonly Scenario[] = [
  {
    app: 'publishing',
    currentRel: 'article-drafting:main',
    attention: 'explicit',
    expectedActions: ['next', 'abandon'],
    fact: { pointer: '/properties/node', value: 'basic-info' },
  },
  {
    app: 'community',
    currentRel: 'comment:c1',
    attention: 'presence',
    expectedActions: ['approve', 'reject'],
    fact: { pointer: '/properties/fields/body', value: '好文章' },
  },
  {
    app: 'governance',
    currentRel: 'agent-definition-request:main',
    attention: 'explicit',
    expectedActions: ['author-another'],
    fact: { pointer: '/properties/fields/draftRel', value: 'draft:t39-agent-definition' },
  },
];

describe('T39 real Application Assistant/Human contract parity', () => {
  it.each(scenarios)(
    '$app: Situation → disclosure → current Siren cognition stays bounded and contract-backed',
    async (scenario) => {
      const snapshot = baseSnapshot();
      if (scenario.app === 'governance') {
        snapshot.instances[scenario.currentRel] = {
          ...snapshot.instances[scenario.currentRel]!,
          node: 'draft-ready',
          fields: {
            draftRel: { value: scenario.fact.value, origin: 'effect' },
            runId: { value: 'agent-run:t39-authoring', origin: 'effect' },
          },
        };
      }

      const attention = {
        site: 'workstation',
        scope: scenario.app,
        thread: `thread:${scenario.app}:acceptance`,
        focus: scenario.currentRel,
      };
      const situation = assembleSituation({
        principal: 'user:t39-parity',
        grantedScopes: ['publishing', 'community', 'governance'],
        ...(scenario.attention === 'explicit'
          ? {
              explicit: attention,
              presence: {
                principal: 'user:t39-parity',
                site: 'stored-workstation',
                scope: 'community',
                thread: 'thread:stored',
                focus: 'comment:c2',
                updatedSeq: 37,
              },
            }
          : {
              presence: { principal: 'user:t39-parity', ...attention, updatedSeq: 38 },
            }),
        defaults: { site: 'workstation' },
      });
      expect(situation).toMatchObject({
        scope: scenario.app,
        thread: attention.thread,
        focus: scenario.currentRel,
        disclosure: {
          scope: scenario.app,
          thread: attention.thread,
          focus: scenario.currentRel,
        },
      });
      expect(
        resolveStartRel({
          situation,
          snapshot,
          sitemap: deriveSitemap(bundle.flows, {
            applications,
            capabilities: Object.fromEntries(
              bundle.capabilities.map((capability) => [capability.name, capability]),
            ),
          }),
          granted: null,
        }),
      ).toEqual({ rel: scenario.currentRel });

      const humanEntity = project(snapshot, scenario.currentRel, {
        flows,
        guards: seedGuardRegistry,
      });
      if (humanEntity === undefined) throw new Error(`missing exact Siren ${scenario.currentRel}`);
      const agentEntity = withProviderExcludedPayload(humanEntity);
      const fullSitemap = await sitemapFromRealWire();
      const disclosedSitemap = sliceSitemapDisclosure(fullSitemap, {
        scope: situation.disclosure.scope,
        currentRel: scenario.currentRel,
      });
      expect(disclosedSitemap.applications.map(({ name }) => name)).toEqual([scenario.app]);

      const returnRoute = `/applications/${scenario.app}?thread=${encodeURIComponent(attention.thread)}&focus=${encodeURIComponent(scenario.currentRel)}&return=%2Fapplications`;
      const context: DriverContext = {
        goal: { verb: `读取 ${scenario.app} 当前工作`, targetRel: scenario.currentRel },
        app: situation.scope,
        currentRel: scenario.currentRel,
        entity: agentEntity,
        observations: [
          { rel: 'old:observation', entity: oldObservation() },
          { rel: scenario.currentRel, entity: agentEntity },
        ],
        trail: [
          {
            step: 1,
            rel: scenario.currentRel,
            op: { kind: 'navigate', rel: scenario.currentRel },
            outcome: 'navigated',
            entity: {
              rel: scenario.currentRel,
              class: [...humanEntity.class],
              node: String(humanEntity.properties.node),
              actions: humanEntity.actions.map(({ name }) => name),
            },
          },
        ],
        successes: [],
        sitemap: disclosedSitemap,
        clientView: {
          schemaVersion: 2,
          presence: {
            clientInstanceId: `client:${scenario.app}`,
            site: situation.site,
            scope: situation.scope ?? null,
            thread: situation.thread,
            focus: situation.focus,
          },
          sourceMessageId: `message:${scenario.app}`,
          observedAtSeq: 39,
        },
        lastNavigation: {
          schemaVersion: 1,
          navigationId: `navigation:${scenario.app}`,
          source: 'agent-navigate',
          sessionId: 'session:t39-parity',
          turnId: `turn:${scenario.app}`,
          subject: scenario.currentRel,
          route: returnRoute,
          sourceMessageIds: [`message:${scenario.app}`],
          step: 1,
          completedAtSeq: 38,
        },
      };

      const { rawBody, operation } = await providerDecision(context, {
        rel: scenario.currentRel,
        pointer: scenario.fact.pointer,
      });
      expect(operation).toEqual({
        kind: 'answer',
        content: '已按当前合同读取。',
        sources: [{ rel: scenario.currentRel, pointer: scenario.fact.pointer }],
      });
      expect(pointerValue(humanEntity, scenario.fact.pointer)).toEqual(scenario.fact.value);
      expect(pointerValue(agentEntity, scenario.fact.pointer)).toEqual(scenario.fact.value);

      expect(Buffer.byteLength(rawBody, 'utf8')).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
      const providerRequest = JSON.parse(rawBody) as { messages?: Array<{ content?: string }> };
      const prompt = providerRequest.messages?.at(-1)?.content;
      if (typeof prompt !== 'string') throw new Error('provider prompt was not found');
      expect(prompt).toContain(`"scope": "${scenario.app}"`);
      expect(prompt).toContain(`"thread": "${attention.thread}"`);
      expect(prompt).toContain(`"focus": "${scenario.currentRel}"`);
      expect(prompt).toContain(returnRoute);

      const sitemapSection = section(
        prompt,
        '## 当前 app/scope 的动态 sitemap 分层披露',
        '## 当前授权实体的认知投影',
      );
      expect(
        (sitemapSection.applications as Array<{ name: string }>).map(({ name }) => name),
      ).toEqual([scenario.app]);

      const observation = section(
        prompt,
        '## 当前授权实体的认知投影(完整 HTTP Siren 合同不在 provider prompt 中)',
        '## 结构化轨迹',
      );
      const observedEntity = observation.entity as SirenEntity;
      expect(observation.rel).toBe(scenario.currentRel);
      expect(observedEntity.actions.map(({ name }) => name)).toEqual(scenario.expectedActions);
      expect(observedEntity.actions.map(({ name, title }) => ({ name, title }))).toEqual(
        humanEntity.actions.map(({ name, title }) => ({ name, title })),
      );
      expect(observedEntity.links.map(({ rel }) => rel)).toEqual(
        humanEntity.links.map(({ rel }) => rel),
      );
      expect(
        observedEntity['guard-results']?.map(({ action, blocked, reason }) => ({
          action,
          blocked,
          ...(reason === undefined ? {} : { reason }),
        })),
      ).toEqual(
        humanEntity['guard-results']?.map(({ action, blocked, reason }) => ({
          action,
          blocked,
          ...(reason === undefined ? {} : { reason }),
        })),
      );
      expect(humanEntity.actions.every(({ href }) => href === '/api/exec')).toBe(true);
      for (const action of scenario.expectedActions) {
        expect(rawBody).toContain(`action_${action}`);
      }

      expect(rawBody).not.toContain(OLD_OBSERVATION_MARKER);
      expect(rawBody).not.toContain(RAW_ENTITY_MARKER);
      for (const marker of Object.values(VISUAL_MARKERS)) {
        expect(rawBody).not.toContain(marker);
      }
      if (scenario.app === 'community' || scenario.app === 'governance') {
        expect(observedEntity.properties.presentation).toMatchObject({
          traits: expect.arrayContaining(['human-responsibility']),
        });
      }
      if (scenario.app === 'governance') {
        expect(agentEntity.class).not.toContain('meta');
        expect(scenario.currentRel).not.toMatch(/^meta[/:]/);
        expect(observedEntity.properties.fields).toMatchObject({
          draftRel: 'draft:t39-agent-definition',
        });
        expect(
          (observedEntity.properties.presentation as { fields: Array<{ role?: string }> }).fields,
        ).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'relation' })]));
      }
    },
  );

  it('headless multi-grant Situation does not invent a default or publishing lens', () => {
    const situation = assembleSituation({
      principal: 'user:t39-headless',
      grantedScopes: ['default', 'publishing'],
      defaults: { site: 'workstation' },
    });

    expect(situation.scope).toBeUndefined();
    expect(situation.disclosure.scope).toBeUndefined();
    expect(situation.thread).toBeNull();
    expect(situation.focus).toBeNull();
    expect(buildSystemPrompt({ app: situation.scope })).not.toContain('## 角色与应用上下文');
  });
});
