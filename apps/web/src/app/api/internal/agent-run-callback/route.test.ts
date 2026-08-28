import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAgentRunTables } from '@ui4a/db/agent-runs';
import { getPool } from '@ui4a/db/pool';
import { POST } from './route';

const pool = getPool(process.env.DATABASE_URL!);

function request(token: string, body: unknown = { runId: 'missing-run' }) {
  return new Request('http://localhost:3100/api/internal/agent-run-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui4a-capability-token': token },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.stubEnv('UI4A_CAPABILITY_CALLBACK_TOKEN', 'agent-run-test-token');
  await ensureAgentRunTables(pool);
  await pool.query(
    'TRUNCATE agent_run_projection, agent_run_projection_state, agent_run_payloads, events',
  );
});

describe('internal Agent Run callback', () => {
  it('requires the deployment token and a typed Run identity', async () => {
    expect((await POST(request('bad'))).status).toBe(401);
    expect((await POST(request('agent-run-test-token', {}))).status).toBe(400);
    expect((await POST(request('agent-run-test-token'))).status).toBe(404);
  });
});
