import { beforeEach, expect, it, vi } from 'vitest';
import { project } from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

const mocks = vi.hoisted(() => ({
  snapshot: {} as EngineSnapshot,
  events: [] as Array<{ principal: string; detail: Record<string, string> }>,
  query: vi.fn(),
}));
vi.mock('@ui4a/db/events', () => ({
  listEvents: async (_db: unknown, _after: number, options: { principal: string }) => {
    mocks.query(options);
    return mocks.events.filter((event) => event.principal === options.principal);
  },
}));
vi.mock('../service', () => ({
  getDb: () => ({}),
  isMetaRel: () => false,
  LlmArtifactConfigurationError: class extends Error {},
  getEngine: async () => ({
    getSnapshot: () => mocks.snapshot,
    readSnapshot: async () => mocks.snapshot,
    getSitemap: () => ({
      version: 'test',
      surfaces: [],
      flows: [],
      applications: [],
      capabilities: [],
    }),
    getEntity: async (rel: string) =>
      project(mocks.snapshot, rel, { flows: {}, guards: seedGuardRegistry }),
    exec: async () => ({
      kind: 'accepted',
      entity: project(mocks.snapshot, 'thread:t', { flows: {}, guards: seedGuardRegistry }),
    }),
  }),
}));
vi.mock('../agent/agent-runs', () => ({
  isAgentRunRel: () => false,
  getAgentRunEntity: vi.fn(),
  enrichEntityWithAgentRuns: async (_db: unknown, entity: unknown) => entity,
}));
vi.mock('../../auth/request-identity', () => ({
  resolveTrustedRequestIdentity: async () => ({
    principal: 'me',
    authorizationMode: 'local',
    grantedApplications: [],
  }),
  authenticationErrorResponse: () => undefined,
  applyTrustedIdentity: (request: object) => ({ ...request, principal: 'me' }),
  requireHumanApprovalScope: vi.fn(),
}));
import { GET } from '../../app/api/entity/route';
import { POST } from '../../app/api/exec/route';
import {
  getAuthorizedPresentationEntity,
  getAuthorizedPresentationResult,
} from '../presentation/authorized-entity';

beforeEach(() => {
  mocks.query.mockClear();
  mocks.snapshot = {
    instances: {},
    collections: {},
    threads: {
      t: {
        id: 't',
        owner: 'me',
        goal: { text: 'Review', source: 'source:a' },
        status: 'open',
        recentEventSeqs: [],
        references: {
          context: ['message:own', 'message:other', 'message:missing'],
          active: [],
          approval: [],
          event: [],
        },
      },
    },
  };
  mocks.events = [
    {
      principal: 'me',
      detail: {
        messageId: 'own',
        content: 'Original material',
        role: 'user',
        sessionId: 's',
        turnId: 't',
      },
    },
    {
      principal: 'another',
      detail: { messageId: 'other', content: 'Private material', role: 'user' },
    },
  ];
});

it('HTTP and Presentation resolve current principal message summaries from the same original event', async () => {
  const response = await GET(new Request('https://ui4a.test/api/entity?rel=thread:t'));
  expect(response.status).toBe(200);
  const http = await response.json();
  const presentation = await getAuthorizedPresentationEntity('thread:t', 'me', ['local-demo']);
  expect(presentation).toEqual(http);
  expect(http.entities[0].properties).toMatchObject({
    rel: 'message:own',
    identity: 'Original material',
  });
  expect(http.entities[0].class).not.toContain('dangling');
  expect(http.entities[0].properties.status).toBeUndefined();
  expect(
    http.links.find((link: { href: string }) => link.href.endsWith('message:own')).rel,
  ).not.toContain('dangling');
  expect(JSON.stringify(http)).not.toContain('Private material');
  expect(http.entities[1].properties.statusText).toBe(http.entities[2].properties.statusText);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ principal: 'me' }));
});

it('Presentation message details and HTTP details agree; cross-principal and missing both hide existence', async () => {
  const response = await GET(new Request('https://ui4a.test/api/entity?rel=message:own'));
  const presentation = await getAuthorizedPresentationEntity('message:own', 'me', ['local-demo']);
  expect(presentation).toEqual(await response.json());
  expect(presentation?.properties.content).toBe('Original material');
  for (const rel of ['message:other', 'message:missing']) {
    expect((await GET(new Request(`https://ui4a.test/api/entity?rel=${rel}`))).status).toBe(404);
    expect(await getAuthorizedPresentationEntity(rel, 'me', ['local-demo'])).toBeUndefined();
  }
});

it('accepted mutation receipts use the same current message and detach-option projection', async () => {
  const response = await POST(
    new Request('https://ui4a.test/api/exec', {
      method: 'POST',
      body: JSON.stringify({
        rel: 'thread:t',
        action: 'attach-context',
        params: { rel: 'message:own' },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const { entity } = await response.json();
  expect(entity).toEqual(await getAuthorizedPresentationEntity('thread:t', 'me', ['local-demo']));
  expect(
    entity.actions.find((action: { name: string }) => action.name === 'detach').fields[
      'x-ui4a-reference-selection'
    ].options[0],
  ).toEqual({
    title: 'Original material',
    params: { category: 'context', rel: 'message:own' },
  });
});

it('never reads message events for another principal work thread or a collection pruned to empty', async () => {
  mocks.snapshot.threads!.t!.owner = 'another';
  expect(await getAuthorizedPresentationEntity('thread:t', 'me', ['local-demo'])).toBeUndefined();
  const collection = await getAuthorizedPresentationEntity('threads', 'me', ['local-demo']);
  expect(collection?.entities).toEqual([]);
  expect(mocks.query).not.toHaveBeenCalled();
});

it('does not invent a message identifier from a malformed canonical event', async () => {
  mocks.events.push({ principal: 'me', detail: { content: 'Missing identity' } });
  expect(
    (await GET(new Request('https://ui4a.test/api/entity?rel=message:undefined'))).status,
  ).toBe(404);
});

it('keeps an accepted mutation receipt when the subsequent optional message read fails', async () => {
  mocks.snapshot.threads!.t!.references.active = ['message:own'];
  mocks.query.mockImplementationOnce(() => {
    throw Object.assign(new Error('message read lost connection'), { code: 'ECONNRESET' });
  });
  const response = await POST(
    new Request('https://ui4a.test/api/exec', {
      method: 'POST',
      body: JSON.stringify({
        rel: 'thread:t',
        action: 'attach',
        params: { category: 'context', rel: 'message:own' },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const { entity } = await response.json();
  expect(entity.properties.rel).toBe('thread:t');
  expect(entity.properties.active).toEqual([{ rel: 'message:own' }]);
  expect(entity.entities[0].properties).toMatchObject({
    rel: 'message:own',
    identity: '无法读取的消息',
    statusText: '暂时无法读取此材料',
  });
  expect(entity.entities[0].class).toContain('unavailable');
  expect(entity.entities[0].class).not.toContain('dangling');
  expect(
    entity.actions.find((candidate: { name: string }) => candidate.name === 'detach'),
  ).toBeDefined();
});

it('keeps ordinary message enrichment failures distinct from missing message records', async () => {
  mocks.query.mockImplementationOnce(() => {
    throw Object.assign(new Error('message read lost connection'), { code: 'ECONNRESET' });
  });
  const response = await GET(new Request('https://ui4a.test/api/entity?rel=thread:t'));
  expect(response.status).toBeGreaterThanOrEqual(500);
  const body = await response.json();
  expect(body).not.toHaveProperty('entities');
  mocks.query.mockImplementationOnce(() => {
    throw new Error('message read failed');
  });
  await expect(getAuthorizedPresentationResult('thread:t', 'me', ['local-demo'])).rejects.toThrow(
    'message read failed',
  );
});
