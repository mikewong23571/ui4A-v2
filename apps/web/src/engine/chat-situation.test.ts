import { beforeEach, describe, expect, it } from 'vitest';

import { CHAT_VIEW_PROTOCOL_VERSION, type ClientViewReport } from '@ui4a/shared';

import type { TrustedRequestAuditContext } from '../auth/request-identity';
import { appendPresenceChange, ensurePresenceTables } from '../db/presence';
import { getPool } from '../db/pool';

import { situationForChat } from './chat-situation';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const PRINCIPAL = 'user:client-view-lock';

/** 与本地 profile resolveTrustedRequestIdentity 产物同构的受信身份。 */
function identityWith(
  overrides: Partial<Pick<TrustedRequestAuditContext, 'scopes' | 'policyScope'>> = {},
): TrustedRequestAuditContext {
  return {
    authorizationMode: 'self-reported-local-demo',
    actor: 'human',
    principal: PRINCIPAL,
    scopes: ['development', 'publishing'],
    policyScope: 'development',
    channel: 'http',
    humanApprovalEligible: true,
    ...overrides,
  };
}

function clientView(
  presence: Partial<ClientViewReport['presence']> = {},
): NonNullable<Parameters<typeof situationForChat>[0]['clientView']> {
  return {
    schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
    presence: {
      clientInstanceId: 'client-view-lock',
      site: 'desk-view',
      scope: null,
      thread: null,
      focus: null,
      ...presence,
    },
  };
}

async function writeStoredPresence(site: string, scope: string): Promise<void> {
  const identity = { principal: PRINCIPAL, actor: 'human' as const, channel: 'test' };
  await appendPresenceChange(pool, { schemaVersion: 1, kind: 'site', value: site }, identity);
  await appendPresenceChange(pool, { schemaVersion: 1, kind: 'scope', value: scope }, identity);
}

beforeEach(async () => {
  await ensurePresenceTables(pool);
  await pool.query('TRUNCATE presence_current');
});

describe('chat situation adapter', () => {
  it('keeps headless chat on the workstation deployment default without a client view', async () => {
    await expect(situationForChat({ principal: 'user:headless' })).resolves.toMatchObject({
      site: 'workstation',
      scope: 'default',
      focus: null,
    });
  });

  // T31 R9(←T29,D48 裁决 b):clientView.presence 进入 explicit 槽位是有意分层——
  // "显式"指请求明示信号的正典地位(时间最新、随请求给出),不是更高特权;
  // scope 越权始终由 grantedScopes 收口。以下行为测试钉死该语义。

  it('treats clientView presence values as request-explicit and lets them outrank stored presence', async () => {
    await writeStoredPresence('desk-stored', 'publishing');
    const situation = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith(),
      clientView: clientView({ site: 'desk-view', scope: 'development' }),
    });
    expect(situation.site).toBe('desk-view');
    expect(situation.scope).toBe('development');
    expect(situation.disclosure.scope).toBe(situation.scope);
  });

  it('moves the situation when the explicit slot changes while staying inside the grant envelope', async () => {
    // stored presence 固定在 development:flip 后的 explicit('publishing')若被降级
    // 出 explicit 槽位,回退会落在 development 而非 publishing,本测试即红。
    await writeStoredPresence('desk-stored', 'development');
    const flipped = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith(),
      clientView: clientView({ site: 'desk-next', scope: 'publishing' }),
    });
    expect(flipped.site).toBe('desk-next');
    expect(flipped.scope).toBe('publishing');
  });

  it('folds an out-of-envelope clientView scope back into the authorized grant set', async () => {
    await writeStoredPresence('desk-stored', 'publishing');
    const situation = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith(),
      clientView: clientView({ site: 'desk-view', scope: 'no-such-app' }),
    });
    expect(situation.scope).not.toBe('no-such-app');
    expect(situation.scope).toBe('publishing');
  });
});
