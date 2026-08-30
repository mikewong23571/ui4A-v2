'use client';

import type { SirenEntity } from '@ui4a/engine';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { useMetaEntity } from '../meta-client';
import { withMetaNavigationContext, type MetaNavigationContext } from '../meta-navigation';
import { draftViewModel } from '../view-models/draft';
import { browserHrefForContractHref, MetaActions, RawContract } from './common';
import { DraftResponsibility } from './draft-review-responsibility';

function JsonPanel({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-5">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function DraftDecision({
  rel,
  scope,
  onChanged,
}: {
  rel: string;
  scope?: string;
  onChanged?: () => void;
}) {
  const { entity, state, refresh } = useMetaEntity(rel, scope);
  if (state === 'loading')
    return <Card className="p-4 text-sm text-muted-foreground">正在读取当前决策合同…</Card>;
  if (state !== 'ready' || entity === null)
    return (
      <Alert variant="destructive">
        <AlertTitle>决策合同不可用</AlertTitle>
        <AlertDescription>保留当前审查现场；刷新或检查 Scope 后重试。</AlertDescription>
      </Alert>
    );
  return (
    <div className="sticky bottom-3 z-10 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
      <p className="mb-3 text-sm font-medium">
        Human-only decision · 每次提交前重新读取当前 action
      </p>
      <MetaActions
        entity={entity}
        rel={rel}
        scope={scope}
        onChanged={() => {
          refresh();
          onChanged?.();
        }}
      />
    </div>
  );
}

export function DraftRenderer({
  entity,
  navigation,
  onChanged,
}: {
  entity: SirenEntity;
  navigation: MetaNavigationContext;
  onChanged?: () => void;
}) {
  const view = draftViewModel(entity);
  const activation =
    typeof entity.properties.activation === 'string' ? entity.properties.activation : undefined;
  const untitledSourceLinks = entity.links.filter(
    (link) => link.rel.includes('source') && link.title === undefined,
  );
  return (
    <div className="space-y-7 pb-20">
      <header className="space-y-3 border-b pb-5">
        <nav className="text-sm text-muted-foreground">
          <a href={withMetaNavigationContext('/meta', navigation) ?? '/meta'}>定义管理</a> / Drafts
          / {view.id}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Badge>{view.status}</Badge>
          <Badge variant="outline">{view.kind}</Badge>
          <Badge variant="outline">
            v{view.version}/{view.maxVersion}
          </Badge>
        </div>
        <h1 className="break-words text-3xl font-semibold tracking-tight">
          {view.target || view.id}
        </h1>
        <p className="text-sm text-muted-foreground">
          owner {view.owner} · scope {view.policyScope}
          {view.expiresAt === '' ? '' : ` · expires ${view.expiresAt}`}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Validation</h2>
        {view.issues.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>{view.issues.length} 个阻塞问题</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 space-y-2">
                {view.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>
                    <span className="font-medium">{issue.path || '/'}</span> · {issue.message}{' '}
                    <span className="text-xs">({issue.code})</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>当前版本没有阻塞问题</AlertTitle>
            <AlertDescription>校验事实来自当前 Draft 合同投影。</AlertDescription>
          </Alert>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Mechanical diff</h2>
        <Card className="min-w-0 p-4">
          <JsonPanel value={view.diff} />
        </Card>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Checks</h2>
        <div className="space-y-2">
          {view.checks.map((check) => (
            <Card key={check.name} className="flex items-start gap-3 p-4">
              <Badge variant={check.pass ? 'secondary' : 'destructive'}>
                {check.pass ? 'PASS' : 'FAIL'}
              </Badge>
              <div>
                <p className="font-medium">{check.name}</p>
                {check.detail.length > 0 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {check.detail.map(String).join(' · ')}
                  </p>
                )}
              </div>
            </Card>
          ))}
          {view.checks.length === 0 && (
            <p className="text-sm text-muted-foreground">当前合同未投影 checks。</p>
          )}
        </div>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Evaluation</h2>
          <Card className="p-4">
            <JsonPanel value={view.evaluation} />
          </Card>
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Sources & provenance</h2>
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap gap-2 text-sm">
              {view.sources.length === 0 && <span>无 source reference</span>}
              {view.sources.length > 0 && <span>{view.sources.length} 条 source reference</span>}
              {untitledSourceLinks.map((link, index) => {
                const href = browserHrefForContractHref(link.href, navigation);
                const source = view.sources[index];
                if (href === null || source === undefined) return null;
                return (
                  <a
                    key={`${link.href}:${index}`}
                    href={href}
                    className="text-primary hover:underline"
                  >
                    {source}
                  </a>
                );
              })}
            </div>
            <JsonPanel value={view.provenanceDetails} />
          </Card>
        </div>
      </section>
      <DraftResponsibility responsibility={view.responsibility} navigation={navigation} />
      <MetaActions
        entity={entity}
        rel={view.rel}
        scope={navigation.scope}
        onChanged={onChanged}
        prefill={{ payload: view.payload }}
      />
      {activation !== undefined && (
        <DraftDecision rel={activation} scope={navigation.scope} onChanged={onChanged} />
      )}
      {view.terminalReason !== '' && (
        <Alert>
          <AlertTitle>Terminal</AlertTitle>
          <AlertDescription>{view.terminalReason}</AlertDescription>
        </Alert>
      )}
      <RawContract entity={entity} />
    </div>
  );
}
