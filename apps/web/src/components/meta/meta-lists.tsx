'use client';
/**
 * BIOS 列表面(T4 Phase C):meta/flows 定义清单与 meta/activations 激活队列。
 *
 * 读 /_meta/api/entity(同引擎同日志;进入定义层是显式意图),成员链接进
 * BIOS 详情页。纯导航渲染,零 AI;队列为空是常态而非异常,如实呈现。
 */
import type { SirenEntity } from '@ui4a/engine';
import type { ReactNode } from 'react';

import { useMetaEntity } from './meta-client';

/** 集合成员的直达 rel(从 /_meta/api/entity?rel=… href 提取)。 */
function memberRel(sub: SirenEntity): string | null {
  const query = (sub.href ?? '').split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
}

function BiosShell({
  title,
  backTo = '/meta',
  children,
}: {
  title: string;
  backTo?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <nav className="mb-2 text-sm">
        <a href={backTo} className="text-blue-600 hover:underline">
          ← BIOS
        </a>
      </nav>
      <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
      {children}
    </main>
  );
}

/** 定义清单:meta/flows 成员逐条 → /meta/flow/<name>。 */
export function FlowsListBody() {
  const { entity, state } = useMetaEntity('meta/flows');
  if (state === 'loading') {
    return (
      <BiosShell title="流程定义">
        <p className="mt-4 text-sm text-zinc-500">加载中…</p>
      </BiosShell>
    );
  }
  if (state !== 'ready' || entity === null) {
    return (
      <BiosShell title="流程定义">
        <p className="mt-4 text-sm text-zinc-700">
          {state === 'missing' ? '定义清单不可用(404)。' : '读取定义清单失败(服务不可用)。'}
        </p>
      </BiosShell>
    );
  }
  const members = entity.entities ?? [];
  return (
    <BiosShell title={`流程定义(${members.length})`}>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
            <th className="py-1 pr-4">flow</th>
            <th className="py-1 pr-4">版本</th>
            <th className="py-1">状态</th>
          </tr>
        </thead>
        <tbody>
          {members.map((sub) => {
            const rel = memberRel(sub) ?? '';
            const name = String(sub.properties.name ?? rel);
            return (
              <tr key={rel} className="border-b border-zinc-100">
                <td className="py-1 pr-4">
                  <a href={`/meta/flow/${encodeURIComponent(name)}`} className="text-blue-600 hover:underline">
                    {name}
                  </a>
                </td>
                <td className="py-1 pr-4 text-zinc-800">v{String(sub.properties.version ?? '')}</td>
                <td className="py-1 text-zinc-800">{String(sub.properties.status ?? '')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </BiosShell>
  );
}

/** 激活队列:meta/activations 的 pending 成员逐条 → /meta/activation/<id>。 */
export function ActivationsQueueBody() {
  const { entity, state } = useMetaEntity('meta/activations');
  if (state === 'loading') {
    return (
      <BiosShell title="激活队列">
        <p className="mt-4 text-sm text-zinc-500">加载中…</p>
      </BiosShell>
    );
  }
  if (state !== 'ready' || entity === null) {
    return (
      <BiosShell title="激活队列">
        <p className="mt-4 text-sm text-zinc-700">
          {state === 'missing' ? '激活队列不可用(404)。' : '读取激活队列失败(服务不可用)。'}
        </p>
      </BiosShell>
    );
  }
  const members = entity.entities ?? [];
  return (
    <BiosShell title={`激活队列(待审 ${members.length})`}>
      {members.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">队列为空(无待批准的定义激活)。</p>
      ) : (
        <ul className="mt-4 space-y-1 text-sm">
          {members.map((sub) => {
            const rel = memberRel(sub) ?? '';
            const id = String(sub.properties.id ?? rel);
            const requestedBy = sub.properties['requested-by'] as
              | { actor?: string; principal?: string }
              | undefined;
            return (
              <li key={rel}>
                <a
                  href={`/meta/activation/${encodeURIComponent(id)}`}
                  className="text-blue-600 hover:underline"
                >
                  {id} · {String(sub.properties.flow ?? '')} → v{String(sub.properties.version ?? '')}
                  {requestedBy !== undefined
                    ? ` · 提议 ${requestedBy.actor ?? '?'}${requestedBy.principal ?? ''}`
                    : ''}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </BiosShell>
  );
}
