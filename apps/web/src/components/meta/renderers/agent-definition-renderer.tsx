'use client';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { agentDefinitionViewModel, redactMetaValue } from '../view-models/agent-definition';
import { browserHrefForContractHref, RawContract } from './common';

function JsonPanel({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-5">
      {JSON.stringify(redactMetaValue(value ?? {}), null, 2)}
    </pre>
  );
}

export function AgentDefinitionRenderer({ entity, scope }: { entity: SirenEntity; scope: string }) {
  const view = agentDefinitionViewModel(entity);
  return (
    <div className="space-y-7">
      <header className="space-y-3 border-b pb-5">
        <nav className="text-sm text-muted-foreground">
          <a href="/meta" className="hover:text-foreground">
            定义管理
          </a>{' '}
          / Agent Definitions / {view.ref}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Badge>{view.status}</Badge>
          <Badge variant="outline">birth v{view.version}</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{view.ref || view.name}</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground">{view.intent}</p>
      </header>

      <section
        aria-label="Authority binding deployment boundaries"
        className="grid gap-3 lg:grid-cols-3"
      >
        <Card className="p-4">
          <h2 className="font-semibold">封闭权威</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            sealed system blocks define instruction authority; they do not grant actions.
          </p>
          <p className="mt-3 text-2xl font-semibold">{view.authority.length}</p>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">数据绑定</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Task/context values enter typed, JSON-delimited blocks.
          </p>
          <p className="mt-3 text-2xl font-semibold">{view.bindings.length}</p>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">部署要求</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.runtime.class || '未声明 runtime'} ·{' '}
            {view.runtime.features.join(', ') || '无 feature'}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Provider profile 与 credential 由服务端部署解析，不属于本合同。
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Prompt blocks</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {view.promptBlocks.map((block, index) => (
            <Card key={String(block.id ?? index)} className="min-w-0 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{String(block.role ?? '')}</Badge>
                <Badge variant="secondary">{String(block.purpose ?? '')}</Badge>
                {block.sealed === true && <Badge>sealed</Badge>}
              </div>
              <div className="mt-3">
                <JsonPanel value={block.literal ?? block.binding ?? {}} />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h2 className="text-lg font-semibold">Task contract</h2>
          <JsonPanel value={view.inputSchema} />
        </div>
        <div className="min-w-0 space-y-2">
          <h2 className="text-lg font-semibold">Result contract</h2>
          <JsonPanel value={view.outputSchema} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="font-semibold">Tools</h2>
          <p className="mt-2 text-sm">{view.tools.join(', ') || 'none'}</p>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">Resources</h2>
          <p className="mt-2 text-sm">{view.resources.join(', ') || 'none'}</p>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">Artifacts</h2>
          <JsonPanel value={view.artifactPolicy} />
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Evaluation</h2>
        <Card className="p-4">
          <JsonPanel value={{ policy: view.evaluationPolicy, evidence: view.evaluation }} />
        </Card>
      </section>

      {entity.links.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Versions, Runs & Drafts</h2>
          <div className="flex flex-wrap gap-2">
            {entity.links.flatMap((link, index) => {
              const href = browserHrefForContractHref(link.href, scope);
              return href === null
                ? []
                : [
                    <a
                      key={`${link.href}:${index}`}
                      href={href}
                      className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent"
                    >
                      {link.rel.join(' · ')}
                    </a>,
                  ];
            })}
          </div>
        </section>
      )}
      <RawContract entity={entity} />
    </div>
  );
}
