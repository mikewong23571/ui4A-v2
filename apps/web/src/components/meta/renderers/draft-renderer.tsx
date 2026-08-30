'use client';

import type { SirenEntity } from '@ui4a/engine';
import Form from '@rjsf/core';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { rjsfValidator } from '@/components/rjsf-validator';

import { execMetaAction, useMetaEntity } from '../meta-client';
import { draftEditorSchema, mergeDraftEditorData } from '../view-models/draft-editor-schema';
import { draftViewModel } from '../view-models/draft';
import { browserHrefForContractHref, MetaActions, RawContract } from './common';

function JsonPanel({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-5">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function DraftPayloadEditor({
  entity,
  rel,
  scope,
  kind,
  version,
  payload,
  issuePaths,
  onChanged,
}: {
  entity: SirenEntity;
  rel: string;
  scope?: string;
  kind: string;
  version: number;
  payload: unknown;
  issuePaths: string[];
  onChanged?: () => void;
}) {
  const action = entity.actions.find((candidate) => {
    const required = candidate.fields.required;
    return (
      candidate.name === 'revise' &&
      candidate.href === '/_meta/api/exec' &&
      Array.isArray(required) &&
      required.includes('payload')
    );
  });
  const [candidate, setCandidate] = useState<Record<string, unknown>>(() =>
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {},
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (action === undefined) return null;

  async function submit(formData: Record<string, unknown>): Promise<void> {
    const original =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    setSubmitting(true);
    setFailure(null);
    const result = await execMetaAction({
      rel,
      action: action!.name,
      scope,
      params: {
        commandId: `ui:${rel}:${version}:revise`,
        baseVersion: version,
        payload: mergeDraftEditorData(original, formData, issuePaths),
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setFailure(`[${result.layer}] ${result.reason}`);
      return;
    }
    onChanged?.();
  }

  return (
    <section aria-labelledby="draft-payload-heading" className="space-y-2">
      <div>
        <h2 id="draft-payload-heading" className="text-lg font-semibold">
          修订 Candidate
        </h2>
        <p className="text-sm text-muted-foreground">
          当前版本已预填。保存后系统重新解析、校验并产生新版本；旧版本仍可审计。
        </p>
      </div>
      <Card className="p-4">
        <Form
          idPrefix={`draft_${rel}`.replaceAll(/[^A-Za-z0-9_-]/g, '_')}
          schema={draftEditorSchema(kind, payload, issuePaths)}
          validator={rjsfValidator}
          formData={candidate}
          onChange={({ formData }) => setCandidate(formData as Record<string, unknown>)}
          onSubmit={({ formData }) => void submit(formData as Record<string, unknown>)}
          omitExtraData
          liveOmit
          className="space-y-3 [&_fieldset]:space-y-3 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:bg-background [&_input]:px-2 [&_input]:py-1 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:p-2 [&_select]:rounded-md [&_select]:border [&_select]:bg-background [&_select]:px-2 [&_select]:py-1"
        >
          {failure !== null && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <Button type="submit" data-action="revise" disabled={submitting}>
            {submitting ? '保存中…' : '保存修订'}
          </Button>
        </Form>
      </Card>
    </section>
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
  scope,
  onChanged,
}: {
  entity: SirenEntity;
  scope?: string;
  onChanged?: () => void;
}) {
  const view = draftViewModel(entity);
  const activation =
    typeof entity.properties.activation === 'string' ? entity.properties.activation : undefined;
  const sourceLinks = entity.links.filter((link) => link.rel.includes('source'));
  return (
    <div className="space-y-7 pb-20">
      <header className="space-y-3 border-b pb-5">
        <nav className="text-sm text-muted-foreground">
          <a href="/meta">定义管理</a> / Drafts / {view.id}
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

      {view.issues.length > 0 && (
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
      )}

      <DraftPayloadEditor
        entity={entity}
        rel={view.rel}
        scope={scope}
        kind={view.kind}
        version={view.version}
        payload={view.payload}
        issuePaths={view.issues.map((issue) => issue.path)}
        onChanged={onChanged}
      />

      <MetaActions
        entity={entity}
        rel={view.rel}
        scope={scope}
        onChanged={onChanged}
        prefill={{ payload: view.payload }}
        excludeActions={['revise']}
      />

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
              {view.sources.map((source, index) => {
                const href =
                  sourceLinks[index] === undefined
                    ? null
                    : browserHrefForContractHref(sourceLinks[index]!.href, scope);
                return href === null ? (
                  <span key={source}>{source}</span>
                ) : (
                  <a key={source} href={href} className="text-primary hover:underline">
                    {source}
                  </a>
                );
              })}
            </div>
            <JsonPanel value={view.provenance} />
          </Card>
        </div>
      </section>
      {activation !== undefined && (
        <DraftDecision rel={activation} scope={scope} onChanged={onChanged} />
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
