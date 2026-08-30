'use client';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { applicationViewModel } from '../view-models/application';
import { browserHrefForContractHref, RawContract } from './common';

export function ApplicationRenderer({ entity, scope }: { entity: SirenEntity; scope?: string }) {
  const view = applicationViewModel(entity);
  const flowLinks = entity.links.filter((link) => link.rel.includes('flow'));
  const capabilityLinks = entity.links.filter((link) => link.rel.includes('capability'));
  return (
    <div className="space-y-7">
      <header className="space-y-3 border-b pb-5">
        <nav className="text-sm text-muted-foreground">
          <a
            href="/meta"
            className="hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            定义管理
          </a>{' '}
          / Applications / {view.name}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{view.status}</Badge>
          <Badge variant="outline">v{view.version}</Badge>
          {view.readOnly && <Badge variant="secondary">只读 · 无声明编辑动作</Badge>}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{view.title}</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground">{view.intent}</p>
      </header>

      <section aria-labelledby="application-summary-heading">
        <h2 id="application-summary-heading" className="sr-only">
          组成概览
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Flows', view.flows.length],
            ['Capabilities', view.capabilities.length],
            ['Policies', view.policies.length],
          ].map(([label, count]) => (
            <Card key={String(label)} className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{count}</p>
            </Card>
          ))}
        </div>
      </section>

      <nav aria-label="Application sections" className="flex flex-wrap gap-2 border-b pb-3 text-sm">
        {['flows', 'capabilities', 'policies', 'provenance'].map((section) => (
          <a
            key={section}
            href={`#${section}`}
            className="rounded-md px-3 py-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {section}
          </a>
        ))}
      </nav>

      <section id="flows" className="scroll-mt-16 space-y-3">
        <h2 className="text-lg font-semibold">Flows</h2>
        {view.flows.length === 0 ? (
          <p className="text-sm text-muted-foreground">未声明 Flow。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {view.flows.map((flow, index) => {
              const href =
                flowLinks[index] === undefined
                  ? null
                  : browserHrefForContractHref(flowLinks[index]!.href, scope);
              const body = (
                <Card className="h-full p-4">
                  <p className="font-medium">{flow.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {flow.name}
                    {flow.version === undefined ? '' : ` · birth v${flow.version}`}
                  </p>
                </Card>
              );
              return href === null ? (
                <div key={flow.name}>{body}</div>
              ) : (
                <a
                  key={flow.name}
                  href={href}
                  className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {body}
                </a>
              );
            })}
          </div>
        )}
      </section>

      <section id="capabilities" className="scroll-mt-16 space-y-3">
        <h2 className="text-lg font-semibold">Capabilities</h2>
        {view.capabilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">未声明 Capability。</p>
        ) : (
          view.capabilities.map((capability, index) => {
            const href =
              capabilityLinks[index] === undefined
                ? null
                : browserHrefForContractHref(capabilityLinks[index]!.href, scope);
            const body = (
              <Card className="p-4">
                <p className="font-medium">{capability.title}</p>
                <p className="text-sm text-muted-foreground">
                  {capability.name} · {capability.kind}
                </p>
              </Card>
            );
            return href === null ? (
              <div key={capability.name}>{body}</div>
            ) : (
              <a key={capability.name} href={href}>
                {body}
              </a>
            );
          })
        )}
      </section>

      <section id="policies" className="scroll-mt-16 space-y-3">
        <h2 className="text-lg font-semibold">Policies</h2>
        {view.policies.map((policy, index) => (
          <Card key={`${policy.subject}:${index}`} className="p-4 text-sm">
            <span className="font-medium">{policy.subject}</span>
            <span className="ml-2 text-muted-foreground">submission: {policy.mode}</span>
          </Card>
        ))}
        {view.policies.length === 0 && (
          <p className="text-sm text-muted-foreground">未声明 Policy。</p>
        )}
      </section>

      <section id="provenance" className="scroll-mt-16 space-y-3">
        <h2 className="text-lg font-semibold">Version & Provenance</h2>
        <Card className="overflow-auto p-4">
          <pre className="text-xs">{JSON.stringify(view.provenance ?? {}, null, 2)}</pre>
        </Card>
      </section>
      <RawContract entity={entity} />
    </div>
  );
}
