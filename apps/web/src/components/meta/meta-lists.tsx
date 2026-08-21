'use client';
/**
 * BIOS 列表面(T4 Phase C):meta/flows 定义清单与 meta/activations 激活队列。
 *
 * 读 /_meta/api/entity(同引擎同日志;进入定义层是显式意图),成员链接进
 * BIOS 详情页。纯导航渲染,零 AI;队列为空是常态而非异常,如实呈现。
 */
import type { SirenEntity } from '@ui4a/engine';
import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useMetaEntity } from './meta-client';

/** 集合成员的直达 rel(从 /_meta/api/entity?rel=… href 提取)。 */
function memberRel(sub: SirenEntity): string | null {
  const query = (sub.href ?? '').split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
}

/** 定义状态徽标 variant(active 常态;pending-approval 待审高亮;其余轮廓兜底)。 */
function statusVariant(status: string): ComponentProps<typeof Badge>['variant'] {
  if (status === 'active') return 'secondary';
  if (status === 'pending-approval') return 'default';
  return 'outline';
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
    <div>
      <nav className="mb-2 text-sm">
        <a href={backTo} data-nav="meta-back" className="text-primary hover:underline">
          ← BIOS
        </a>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

/** 定义清单:meta/flows 成员逐条 → /meta/flow/<name>。 */
export function FlowsListBody() {
  const { entity, state } = useMetaEntity('meta/flows');
  if (state === 'loading') {
    return (
      <BiosShell title="流程定义">
        <p className="mt-4 text-sm text-muted-foreground">加载中…</p>
      </BiosShell>
    );
  }
  if (state !== 'ready' || entity === null) {
    return (
      <BiosShell title="流程定义">
        <p className="mt-4 text-sm">
          {state === 'missing' ? '定义清单不可用(404)。' : '读取定义清单失败(服务不可用)。'}
        </p>
      </BiosShell>
    );
  }
  const members = entity.entities ?? [];
  return (
    <BiosShell title={`流程定义(${members.length})`}>
      <div className="mt-4 rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3 text-muted-foreground">flow</TableHead>
              <TableHead className="px-3 text-muted-foreground">版本</TableHead>
              <TableHead className="px-3 text-muted-foreground">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((sub) => {
              const rel = memberRel(sub) ?? '';
              const name = String(sub.properties.name ?? rel);
              const status = String(sub.properties.status ?? '');
              return (
                <TableRow key={rel}>
                  <TableCell className="px-3 py-2">
                    <a
                      href={`/meta/flow/${encodeURIComponent(name)}`}
                      data-nav="meta-flow"
                      className="text-primary hover:underline"
                    >
                      {name}
                    </a>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    v{String(sub.properties.version ?? '')}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <Badge variant={statusVariant(status)}>{status}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </BiosShell>
  );
}

/** 激活队列:meta/activations 的 pending 成员逐条 → /meta/activation/<id>。 */
export function ActivationsQueueBody() {
  const { entity, state } = useMetaEntity('meta/activations');
  if (state === 'loading') {
    return (
      <BiosShell title="激活队列">
        <p className="mt-4 text-sm text-muted-foreground">加载中…</p>
      </BiosShell>
    );
  }
  if (state !== 'ready' || entity === null) {
    return (
      <BiosShell title="激活队列">
        <p className="mt-4 text-sm">
          {state === 'missing' ? '激活队列不可用(404)。' : '读取激活队列失败(服务不可用)。'}
        </p>
      </BiosShell>
    );
  }
  const members = entity.entities ?? [];
  return (
    <BiosShell title={`激活队列(待审 ${members.length})`}>
      {members.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">队列为空(无待批准的定义激活)。</p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border bg-card text-sm">
          {members.map((sub) => {
            const rel = memberRel(sub) ?? '';
            const id = String(sub.properties.id ?? rel);
            const requestedBy = sub.properties['requested-by'] as
              { actor?: string; principal?: string } | undefined;
            return (
              <li key={rel}>
                <a
                  href={`/meta/activation/${encodeURIComponent(id)}`}
                  data-nav="meta-activation"
                  className="block px-3 py-2 break-all text-primary hover:bg-accent hover:underline"
                >
                  {id} · {String(sub.properties.flow ?? '')} → v
                  {String(sub.properties.version ?? '')}
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
