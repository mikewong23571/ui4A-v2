import { beforeEach, describe, expect, it } from 'vitest';

import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { GET as getEntity } from './entity/route';
import { POST as exec } from './exec/route';

const pool = getPool(process.env.DATABASE_URL!);
const headers = {
  'content-type': 'application/json',
  'x-ui4a-principal': 'user:mike',
  'x-ui4a-policy-scope': 'publishing',
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
});

describe('Draft meta HTTP contract', () => {
  it('publishes one strict create schema with client commandId and no server-owned params', async () => {
    const response = await getEntity(
      new Request('http://localhost:3100/_meta/api/entity?rel=meta%2Fdrafts', { headers }),
    );
    expect(response.status).toBe(200);
    const entity = (await response.json()) as {
      actions: Array<{
        name: string;
        fields: {
          properties: Record<string, Record<string, unknown>>;
          required: string[];
          additionalProperties: boolean;
        };
      }>;
    };
    const create = entity.actions.find(({ name }) => name === 'create')!;

    expect(Object.keys(create.fields.properties)).toEqual([
      'kind',
      'target',
      'commandId',
      'payload',
      'sources',
    ]);
    expect(create.fields.properties.commandId).toMatchObject({
      type: 'string',
      'x-ui4a-input-owner': 'client',
    });
    expect(create.fields.required).toEqual(['kind', 'target', 'commandId', 'payload']);
    expect(create.fields.additionalProperties).toBe(false);
    expect(create.fields.properties).not.toHaveProperty('policyScope');
    expect(create.fields.properties).not.toHaveProperty('schemaRef');
  });

  it('uses caller commandId, trusted scope and kind-derived schemaRef, then rejects extra params', async () => {
    const commandId = 'contract:create:accepted';
    const accepted = await exec(
      new Request('http://localhost:3100/_meta/api/exec', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rel: 'meta/drafts',
          action: 'create',
          params: {
            kind: 'flow-definition',
            target: 'post-status',
            commandId,
            payload: { name: 'post-status' },
          },
        }),
      }),
    );
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as {
      entity: { properties: { schemaRef: string; provenance: { commandId: string } } };
    };
    expect(body.entity.properties.schemaRef).toBe('ui4a://flow-definition/v1');
    expect(body.entity.properties.provenance.commandId).toBe(commandId);

    for (const [name, value] of [
      ['policyScope', 'development'],
      ['schemaRef', 'forged://schema'],
      ['actor', 'agent'],
      ['principal', 'user:other'],
      ['mode', 'direct'],
      ['submissionMode', 'direct'],
      ['noDraft', true],
    ] as const) {
      const rejected = await exec(
        new Request('http://localhost:3100/_meta/api/exec', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            rel: 'meta/drafts',
            action: 'create',
            params: {
              kind: 'flow-definition',
              target: 'post-status',
              commandId: `contract:create:extra:${name}`,
              payload: { name: 'post-status' },
              [name]: value,
            },
          }),
        }),
      );
      expect(rejected.status, `params.${name} must be rejected`).toBe(422);
      expect(await rejected.json()).toMatchObject({ layer: 'schema-invalid' });
    }
  });

  it('rejects a raw caller that omits the client-owned commandId', async () => {
    const response = await exec(
      new Request('http://localhost:3100/_meta/api/exec', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rel: 'meta/drafts',
          action: 'create',
          params: {
            kind: 'flow-definition',
            target: 'post-status',
            payload: { name: 'post-status' },
          },
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ layer: 'schema-invalid' });
  });

  it('creates an invalid system-owned Draft and exact read is owner scoped', async () => {
    const commandId = 'contract:create:invalid';
    const response = await exec(
      new Request('http://localhost:3100/_meta/api/exec', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rel: 'meta/drafts',
          action: 'create',
          actor: 'agent',
          principal: 'user:mike',
          channel: 'cli',
          params: {
            kind: 'flow-definition',
            target: 'post-status',
            commandId,
            payload: { name: 'post-status' },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entity: {
        properties: { rel: string; status: string; provenance: { commandId: string } };
      };
    };
    expect(body.entity.properties.status).toBe('invalid');
    expect(body.entity.properties.provenance.commandId).toBe(commandId);

    const exact = await getEntity(
      new Request(
        `http://localhost:3100/_meta/api/entity?rel=${encodeURIComponent(body.entity.properties.rel)}&policyScope=publishing`,
        { headers },
      ),
    );
    expect(exact.status).toBe(200);

    const hidden = await getEntity(
      new Request(
        `http://localhost:3100/_meta/api/entity?rel=${encodeURIComponent(body.entity.properties.rel)}&policyScope=publishing`,
        { headers: { ...headers, 'x-ui4a-principal': 'user:other' } },
      ),
    );
    expect(hidden.status).toBe(404);
  });
});
