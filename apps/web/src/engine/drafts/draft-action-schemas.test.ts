import { beforeEach, describe, expect, it } from 'vitest';

import { applicationBundlePayloadSchema } from '@ui4a/engine';
import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';

// T50 Phase 3 / D69.1:定义提案合同自披露——meta/drafts 的 create/revise 动作
// 携带 x-ui4a-payload-schemas 注解(同一扇门,两个读者:模型/CLI 经动作字段
// 序列化读到 kind→{schema,example};人类表单零退化)。application-bundle
// 分支与 engine 派生(applicationBundlePayloadSchema)逐字节等值;flow/agent
// 分支保持现状宽松({schema:{}},无 example 键),不造新真相。payload 属性
// 本体保持精确 {} 宽松形状——它是表单 JSON textarea 投影与宽松裁决的依据,
// 注解挂 fields 顶层 x- 描述符(RJSF 承重墙证据见
// components/meta/renderers/draft-payload-annotation.test.tsx)。
const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';
const SCOPE = 'development';

function bundlePayload(bundleName = 'demo-bundle'): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: bundleName, version: 1 },
    applications: [
      { name: bundleName, title: 'Demo', intent: 'Demonstrate a governed bundle installation' },
    ],
    capabilities: [],
    flows: [
      {
        name: `${bundleName}-entry`,
        title: 'Demo entry',
        app: bundleName,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: `seed:${bundleName}`, detail: { instances: {} } },
  };
}

let engine: Awaited<ReturnType<typeof getEngine>>;

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  engine = await getEngine(pool);
});

describe('Draft action payload schema annotation (T50 P3 / D69.1)', () => {
  it('annotates the meta/drafts create action with kind-scoped payload schemas', async () => {
    const collection = await getDraftMetaEntity(pool, engine, 'meta/drafts', OWNER, SCOPE);
    const create = collection?.actions.find((candidate) => candidate.name === 'create');
    expect(create).toBeDefined();
    const fields = create!.fields;

    // 注解随动作字段序列化披露(模型/CLI 经实体读取同门获得)。
    expect(JSON.stringify(fields)).toContain('"x-ui4a-payload-schemas"');
    const annotation = fields['x-ui4a-payload-schemas'] as Record<string, unknown>;

    // application-bundle 分支与 engine 派生逐字节等值(schema+example 均在)。
    const derived = applicationBundlePayloadSchema();
    expect(JSON.stringify(annotation['application-bundle'])).toBe(
      JSON.stringify({ schema: derived.schema, example: derived.example }),
    );
    expect(JSON.stringify((annotation['application-bundle'] as { schema: unknown }).schema)).toBe(
      JSON.stringify(derived.schema),
    );
    expect(JSON.stringify((annotation['application-bundle'] as { example: unknown }).example)).toBe(
      JSON.stringify(derived.example),
    );

    // 宽松分支保持现状:仅空 schema,example 键省略,不造新真相。
    expect(annotation['flow-definition']).toEqual({ schema: {} });
    expect(annotation['flow-definition']).not.toHaveProperty('example');
    expect(annotation['agent-definition']).toEqual({ schema: {} });
    expect(annotation['agent-definition']).not.toHaveProperty('example');

    // 人类表单零退化前提:payload 属性保持精确 {} 宽松形状。
    expect(fields.properties).toMatchObject({ payload: {} });
    expect(JSON.stringify((fields.properties as Record<string, unknown>).payload)).toBe('{}');
  });

  it('annotates the revise action on the exact Draft entity byte-identically', async () => {
    const created = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: {
          kind: 'application-bundle',
          target: 'demo-bundle',
          commandId: 'annotation:bundle:create',
          payload: bundlePayload(),
        },
      },
      { policyScope: SCOPE },
    );
    expect(created.kind).toBe('accepted');
    const collection = await getDraftMetaEntity(pool, engine, 'meta/drafts', OWNER, SCOPE);
    const createFields = collection?.actions.find((candidate) => candidate.name === 'create')!
      .fields as Record<string, unknown>;
    const revise =
      created.kind === 'accepted'
        ? created.entity.actions.find((candidate) => candidate.name === 'revise')
        : undefined;
    expect(revise).toBeDefined();
    expect(revise!.fields['x-ui4a-payload-schemas']).toBeDefined();
    expect(createFields['x-ui4a-payload-schemas']).toBeDefined();
    expect(JSON.stringify(revise!.fields['x-ui4a-payload-schemas'])).toBe(
      JSON.stringify(createFields['x-ui4a-payload-schemas']),
    );
    expect(JSON.stringify((revise!.fields.properties as Record<string, unknown>).payload)).toBe(
      '{}',
    );
  });
});
