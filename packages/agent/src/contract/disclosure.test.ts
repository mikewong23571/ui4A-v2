import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { sliceSitemapDisclosure } from './disclosure';
import { createContractClient } from './http';
import type { SitemapSummary } from '../types';

const INPUT_SCHEMA_MARKER = 'INPUT_SCHEMA_MUST_NOT_BE_DISCLOSED';
const OUTPUT_SCHEMA_MARKER = 'OUTPUT_SCHEMA_MUST_NOT_BE_DISCLOSED';
const FOREIGN_SURFACE_MARKER = 'FOREIGN_SURFACE_DETAIL_MUST_NOT_BE_DISCLOSED';
const VISUAL_POLICY_MARKER = 'VISUAL_POLICY_MUST_NOT_ENTER_PROMPT';

const cognitivePresentation = {
  version: 1,
  traits: ['human-responsibility'],
  groupRole: 'responsibility',
  priority: 'high',
  emptyMeaning: 'no-current-responsibility',
  fields: [
    {
      path: 'properties.fields.title',
      title: '标题',
      role: 'identity',
      overview: true,
    },
  ],
};

const alphaApplication: SitemapSummary['applications'][number] = {
  name: 'alpha',
  intent: 'prepare alpha work',
  flows: [
    {
      name: 'alpha-create',
      title: 'Create alpha item',
      actions: [{ name: 'advance', title: 'Advance', node: 'draft', guards: ['has-alpha-input'] }],
    },
    {
      name: 'alpha-review',
      title: 'Review alpha item',
      actions: [{ name: 'accept', title: 'Accept', node: 'ready', guards: [] }],
    },
  ],
};

const betaApplication: SitemapSummary['applications'][number] = {
  name: 'beta',
  intent: 'handle beta work',
  flows: [
    {
      name: 'beta-triage',
      title: 'Triage beta item',
      actions: [{ name: 'classify', title: 'Classify', node: 'open', guards: [] }],
    },
  ],
};

function capability(
  name: string,
  applications: string[],
  flows: string[],
): NonNullable<SitemapSummary['capabilities']>[number] {
  return {
    name,
    title: `${name} title`,
    kind: 'transform',
    intent: `${name} intent`,
    input: `${name} input reference`,
    output: `${name} output reference`,
    inputSchema: {
      type: 'object',
      description: INPUT_SCHEMA_MARKER,
      properties: { payload: { type: 'string', marker: INPUT_SCHEMA_MARKER.repeat(64) } },
    },
    outputSchema: {
      type: 'object',
      description: OUTPUT_SCHEMA_MARKER,
      properties: { result: { type: 'string', marker: OUTPUT_SCHEMA_MARKER.repeat(64) } },
    },
    scope: { applications, flows },
  };
}

type ForeignSurface = SitemapSummary['surfaces'][number] & {
  flow: string;
  actions: { name: string }[];
  capabilitySchema: { marker: string };
};

function sitemapFixture(): SitemapSummary {
  const foreignSurface: ForeignSurface = {
    rel: 'beta-home',
    title: 'Beta entry',
    app: 'beta',
    flow: 'beta-triage',
    actions: [{ name: 'classify' }],
    capabilitySchema: { marker: FOREIGN_SURFACE_MARKER },
  };

  return {
    version: 'fixture-v1',
    surfaces: [
      { rel: 'alpha-home', title: 'Alpha entry', app: 'alpha' },
      { rel: 'alpha-review', title: 'Alpha review', app: 'alpha' },
      foreignSurface,
    ],
    applications: [alphaApplication, betaApplication],
    capabilities: [
      capability('alpha-visible', ['alpha'], ['alpha-create']),
      capability('alpha-wrong-flow', ['alpha'], ['beta-triage']),
      capability('alpha-flow-wrong-app', ['beta'], ['alpha-review']),
      capability('beta-visible', ['beta'], ['beta-triage']),
    ],
  };
}

describe('sliceSitemapDisclosure', () => {
  it('keeps the explicit scope application with its flow/action summaries', () => {
    const disclosed: SitemapSummary = sliceSitemapDisclosure(sitemapFixture(), {
      scope: 'alpha',
      currentRel: 'alpha-home',
    });

    expect(disclosed.applications).toEqual([alphaApplication]);
    expect(disclosed.applications[0]?.flows).toEqual(alphaApplication.flows);
  });

  it('keeps current-scope surfaces and reduces every foreign surface to a navigable entry', () => {
    const disclosed = sliceSitemapDisclosure(sitemapFixture(), {
      scope: 'alpha',
      currentRel: 'alpha-home',
    });

    expect(disclosed.surfaces).toEqual([
      { rel: 'alpha-home', title: 'Alpha entry', app: 'alpha' },
      { rel: 'alpha-review', title: 'Alpha review', app: 'alpha' },
      { rel: 'beta-home', title: 'Beta entry' },
    ]);
    expect(disclosed.surfaces.map(({ rel }) => rel)).toContain('beta-home');
    expect(JSON.stringify(disclosed.surfaces)).not.toContain(FOREIGN_SURFACE_MARKER);
  });

  it('filters capabilities by application and flow scope and removes every schema', () => {
    const disclosed = sliceSitemapDisclosure(sitemapFixture(), {
      scope: 'alpha',
      currentRel: 'alpha-home',
    });

    expect(disclosed.capabilities).toEqual([
      {
        name: 'alpha-visible',
        title: 'alpha-visible title',
        kind: 'transform',
        intent: 'alpha-visible intent',
        input: 'alpha-visible input reference',
        output: 'alpha-visible output reference',
        scope: { applications: ['alpha'], flows: ['alpha-create'] },
      },
    ]);
    const serialized = JSON.stringify(disclosed);
    expect(serialized).not.toContain('inputSchema');
    expect(serialized).not.toContain('outputSchema');
    expect(serialized).not.toContain(INPUT_SCHEMA_MARKER);
    expect(serialized).not.toContain(OUTPUT_SCHEMA_MARKER);
  });

  it('infers scope only from an exact current surface rel carrying an app', () => {
    const disclosed = sliceSitemapDisclosure(sitemapFixture(), { currentRel: 'beta-home' });

    expect(disclosed.applications).toEqual([betaApplication]);
    expect(disclosed.capabilities?.map(({ name }) => name)).toEqual(['beta-visible']);
    expect(disclosed.surfaces).toEqual([
      { rel: 'alpha-home', title: 'Alpha entry' },
      { rel: 'alpha-review', title: 'Alpha review' },
      {
        rel: 'beta-home',
        title: 'Beta entry',
        app: 'beta',
        flow: 'beta-triage',
        actions: [{ name: 'classify' }],
        capabilitySchema: { marker: FOREIGN_SURFACE_MARKER },
      },
    ]);
  });

  it('does not guess scope from currentRel words when no surface rel matches exactly', () => {
    const disclosed = sliceSitemapDisclosure(sitemapFixture(), {
      currentRel: 'alpha-create:item-1',
    });

    expect(disclosed.applications.map(({ name }) => name)).toEqual(['alpha', 'beta']);
    expect(disclosed.surfaces).toEqual(sitemapFixture().surfaces);
    expect(disclosed.capabilities?.map(({ name }) => name)).toEqual([
      'alpha-visible',
      'alpha-wrong-flow',
      'alpha-flow-wrong-app',
      'beta-visible',
    ]);
    const serialized = JSON.stringify(disclosed);
    expect(serialized).not.toContain(INPUT_SCHEMA_MARKER);
    expect(serialized).not.toContain(OUTPUT_SCHEMA_MARKER);
  });

  it('never mutates the input sitemap', () => {
    const input = sitemapFixture();
    const before = structuredClone(input);

    sliceSitemapDisclosure(input, { scope: 'alpha', currentRel: 'alpha-home' });

    expect(input).toEqual(before);
  });

  it('leaves the external HTTP discovery result full and narrows only the prompt view', async () => {
    const wireBody = sitemapFixture();
    const client = createContractClient('https://ui4a.test', async () => Response.json(wireBody));

    const discovered = await client.getSitemap();

    expect(discovered?.capabilities?.[0]?.inputSchema).toBeDefined();
    expect(discovered?.applications.map(({ name }) => name)).toEqual(['alpha', 'beta']);
    expect(
      sliceSitemapDisclosure(discovered!, { scope: 'alpha', currentRel: 'alpha-home' })
        .capabilities?.[0]?.inputSchema,
    ).toBeUndefined();
  });

  it('keeps only explicitly allowlisted cognitive tokens from typed sitemap presentation', () => {
    const input = sitemapFixture();
    input.surfaces[0] = {
      ...input.surfaces[0]!,
      presentation: {
        ...cognitivePresentation,
        density: 'decision-list',
        component: 'DecisionTable',
        unknownFutureKey: VISUAL_POLICY_MARKER,
      },
    } as SitemapSummary['surfaces'][number];
    input.applications[0] = {
      ...input.applications[0]!,
      presentation: {
        ...cognitivePresentation,
        sticky: true,
        definition: { raw: VISUAL_POLICY_MARKER },
      },
    } as SitemapSummary['applications'][number];

    const disclosed = sliceSitemapDisclosure(input, {
      scope: 'alpha',
      currentRel: 'alpha-home',
    });
    const serialized = JSON.stringify(disclosed);

    expect((disclosed.surfaces[0] as { presentation?: unknown }).presentation).toEqual(
      cognitivePresentation,
    );
    expect((disclosed.applications[0] as { presentation?: unknown }).presentation).toEqual(
      cognitivePresentation,
    );
    expect(serialized).not.toContain('density');
    expect(serialized).not.toContain('component');
    expect(serialized).not.toContain('sticky');
    expect(serialized).not.toContain('definition');
    expect(serialized).not.toContain(VISUAL_POLICY_MARKER);
  });

  it('parses the public cognitive sitemap projection without changing its values', async () => {
    const wireBody = sitemapFixture();
    wireBody.surfaces[0] = {
      ...wireBody.surfaces[0]!,
      presentation: cognitivePresentation,
    } as SitemapSummary['surfaces'][number];
    wireBody.applications[0] = {
      ...wireBody.applications[0]!,
      presentation: cognitivePresentation,
    } as SitemapSummary['applications'][number];
    const client = createContractClient('https://ui4a.test', async () => Response.json(wireBody));

    const discovered = await client.getSitemap();

    expect((discovered?.surfaces[0] as { presentation?: unknown }).presentation).toEqual(
      cognitivePresentation,
    );
    expect((discovered?.applications[0] as { presentation?: unknown }).presentation).toEqual(
      cognitivePresentation,
    );
  });

  it('keeps the public exact Siren presentation complete at the HTTP client boundary', async () => {
    const entity = {
      class: ['flow-instance'],
      properties: {
        rel: 'record:alpha',
        presentation: cognitivePresentation,
      },
      actions: [],
      links: [],
    };
    const client = createContractClient('https://ui4a.test', async () => Response.json(entity));

    const result = await client.getEntity('record:alpha');

    expect(result.status).toBe(200);
    expect(result.entity?.properties.presentation).toEqual(cognitivePresentation);
  });
});

describe('disclosure source governance', () => {
  it('contains no product application/entity special case or lexical matching dependency', () => {
    const implementation = readFileSync(new URL('./disclosure.ts', import.meta.url), 'utf8');

    expect(implementation).not.toMatch(
      /['"](?:publishing|community|governance|default|editorial|development|articles|comments)['"]/,
    );
    expect(implementation).not.toMatch(/protocol\/match|\boverlaps\b|\bVERB_LEXICON\b/);
  });

  it('keeps inline and delegated execution on the same public disclosure function', () => {
    const publicIndex = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const inlinePrompt = readFileSync(new URL('../llm/prompts.ts', import.meta.url), 'utf8');
    const workerStep = readFileSync(
      new URL('../../../../apps/worker/src/delegation.ts', import.meta.url),
      'utf8',
    );

    expect(publicIndex).toContain("export * from './contract/disclosure'");
    expect(inlinePrompt).toMatch(
      /import \{ sliceSitemapDisclosure \} from ['"]\.\.\/contract\/disclosure['"]/,
    );
    expect(workerStep).toMatch(
      /import \{[^}]*sliceSitemapDisclosure[^}]*\} from ['"]@ui4a\/agent['"]/s,
    );
    expect(workerStep).toContain('sliceSitemapDisclosure(args.sitemap, {');
  });
});
