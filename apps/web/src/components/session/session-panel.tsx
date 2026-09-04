'use client';
/**
 * 「我的授权」面板(D70.2/D70.3,T51):当前会话授权事实的只读投影,数据唯一来源
 * GET /api/auth/session。auth 平面控件(与顶栏「账户与密码」「退出登录」同门):
 * 唯一动作「刷新授权」= 走既有 /auth/login 新授权请求(D70.4),仅在 credential
 * 模式出现;本地演示模式无登录通道,如实标注。不是第二权威,不含业务动作。
 */
import { useEffect, useState } from 'react';

import { redirectToLoginOnAuthError } from '@/components/auth-redirect';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface SessionProjection {
  authorizationMode: 'credential' | 'self-reported-local-demo';
  actor: string;
  principal: string;
  scopes: string[];
  grantedApplications: string[];
  governanceExpansion: boolean;
  browserLoginScopes?: string[];
}

type PanelState =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; projection: SessionProjection };

function isSessionProjection(value: unknown): value is SessionProjection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.authorizationMode === 'credential' ||
      candidate.authorizationMode === 'self-reported-local-demo') &&
    typeof candidate.principal === 'string' &&
    Array.isArray(candidate.scopes) &&
    Array.isArray(candidate.grantedApplications) &&
    typeof candidate.governanceExpansion === 'boolean'
  );
}

export function SessionPanel() {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/session')
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          redirectToLoginOnAuthError(response.status, body);
          throw new Error(`Session projection HTTP ${response.status}`);
        }
        if (!isSessionProjection(body)) {
          throw new Error('Invalid session projection');
        }
        return body;
      })
      .then((projection) => {
        if (!cancelled) setState({ status: 'ready', projection });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <h1 className="text-3xl font-semibold tracking-tight">我的授权</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          当前会话的授权事实只读投影；应用目录按此集合过滤。
        </p>
      </header>
      {state.status === 'loading' && (
        <Skeleton aria-label="正在读取授权" className="h-24 w-full" />
      )}
      {state.status === 'error' && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <span>授权信息读取失败。</span>
          <button
            type="button"
            data-nav="local:session-retry"
            className="rounded-md border px-3 py-2 hover:bg-accent"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((current) => current + 1);
            }}
          >
            重试
          </button>
        </div>
      )}
      {state.status === 'ready' && <ProjectionCard projection={state.projection} />}
    </div>
  );
}

function ProjectionCard({ projection }: { projection: SessionProjection }) {
  const credential = projection.authorizationMode === 'credential';
  return (
    <section aria-label="授权事实" className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">授权模式</dt>
        <dd className="font-medium">{credential ? '登录凭证' : '本地演示(自报身份)'}</dd>
        <dt className="text-muted-foreground">身份主体</dt>
        <dd className="font-medium">{projection.principal}</dd>
        <dt className="text-muted-foreground">凭证 scope</dt>
        <dd className="flex flex-wrap gap-1.5">
          {projection.scopes.map((scope) => (
            <Badge key={scope} variant="outline">
              {scope}
            </Badge>
          ))}
        </dd>
        <dt className="text-muted-foreground">已授权应用</dt>
        <dd className="flex flex-wrap gap-1.5">
          {projection.grantedApplications.map((application) => (
            <Badge key={application} variant="outline">
              {application}
            </Badge>
          ))}
        </dd>
      </dl>
      {projection.governanceExpansion && (
        <p className="text-xs text-muted-foreground">
          含治理展开：已授权应用集合随当前已安装应用自动生长，无需重新登录。
        </p>
      )}
      {projection.browserLoginScopes !== undefined && (
        <p className="text-xs text-muted-foreground">
          重新登录将请求的授权范围：{projection.browserLoginScopes.join(' ')}
        </p>
      )}
      {credential ? (
        <a
          href="/auth/login?returnTo=/session"
          data-nav="local:session-refresh"
          className="inline-flex rounded-md border px-3 py-2 text-sm underline-offset-4 hover:bg-accent hover:underline"
        >
          刷新授权
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">本地演示模式无登录通道，无需刷新授权。</p>
      )}
    </section>
  );
}
