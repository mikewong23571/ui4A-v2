'use client';

import type { ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';

import type { MetaNavigationContext } from '../meta-navigation';
import { redactMetaValue } from '../view-models/agent-definition';
import { MetaActions, MetaRelationships, publicMetaActions, RawContract } from './common';
import type {
  DeclaredDisclosureField,
  GenericDisclosureContract,
} from './generic-disclosure-contract';
import { projectGenericEvidence } from './generic-evidence-projection';
import { DisclosureValue } from './generic-disclosure-value';
import { projectGenericTask, type GenericTaskProjection } from './generic-task-projection';

function ResponsibilityItem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function FactText({ entry }: { entry?: DeclaredDisclosureField }) {
  return entry === undefined ? null : <DisclosureValue value={entry.value} />;
}

export function GenericResponsibilityDisclosure({
  entity,
  task,
  rel,
  scope,
  onChanged,
}: {
  entity: SirenEntity;
  task: GenericTaskProjection;
  rel: string;
  scope?: string;
  onChanged?: () => void;
}) {
  if (!task.hasHumanResponsibility) return null;
  return (
    <section
      aria-label="人类责任点"
      className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <ResponsibilityItem title="需要决定什么">
          <FactText entry={task.primaryContent} />
        </ResponsibilityItem>
        <ResponsibilityItem title="当前责任">
          <FactText entry={task.status} />
        </ResponsibilityItem>
        <ResponsibilityItem title="下一步">
          <div className="space-y-2">
            {task.actions.map((action) => (
              <p key={action.name}>
                <span className="text-foreground">{action.title}</span>
                {task.guardReasons.get(action.name) !== undefined && (
                  <span className="block text-xs">{task.guardReasons.get(action.name)}</span>
                )}
              </p>
            ))}
          </div>
        </ResponsibilityItem>
      </div>
      <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <MetaActions entity={entity} rel={rel} scope={scope} onChanged={onChanged} />
      </div>
    </section>
  );
}

export function GenericEvidenceDisclosure({
  contract,
}: {
  contract: Extract<GenericDisclosureContract, { kind: 'declared' }>;
}) {
  const evidence = projectGenericEvidence(contract);
  if (evidence.length === 0) return null;
  return (
    <dl
      aria-label="声明证据"
      className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2"
    >
      {evidence.map((entry) => (
        <div key={entry.field.path} className="min-w-0 bg-card p-3">
          <dt className="text-xs font-medium text-muted-foreground">{entry.field.title}</dt>
          <dd className="mt-1 text-sm">
            <DisclosureValue value={entry.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function GenericDeclaredDisclosure({
  entity,
  contract,
  rel,
  navigation,
  descriptorTitle,
  onChanged,
}: {
  entity: SirenEntity;
  contract: Extract<GenericDisclosureContract, { kind: 'declared' }>;
  rel: string;
  navigation: MetaNavigationContext;
  descriptorTitle?: string;
  onChanged?: () => void;
}) {
  const actions = publicMetaActions(entity);
  const task = projectGenericTask(entity, contract, actions);
  const identity =
    typeof task.identity?.value === 'string' && task.identity.value.length > 0
      ? task.identity.value
      : (descriptorTitle ?? '合同实体');

  return (
    <div className="space-y-6">
      <section aria-label="任务语义" className="space-y-5">
        <header className="space-y-3 border-b pb-5">
          <Badge variant="secondary">通用合同视图</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">{identity}</h1>
          {!task.hasHumanResponsibility && <FactText entry={task.primaryContent} />}
          {!task.hasHumanResponsibility && task.status !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{task.status.field.title}</span>
              <Badge variant="outline">
                {typeof task.status.value === 'string'
                  ? task.status.value
                  : JSON.stringify(redactMetaValue(task.status.value))}
              </Badge>
            </div>
          )}
        </header>

        {task.hasHumanResponsibility ? (
          <GenericResponsibilityDisclosure
            entity={entity}
            task={task}
            rel={rel}
            scope={navigation.scope}
            onChanged={onChanged}
          />
        ) : (
          <MetaActions entity={entity} rel={rel} scope={navigation.scope} onChanged={onChanged} />
        )}
      </section>

      <section aria-label="合同证据" className="space-y-5">
        <GenericEvidenceDisclosure contract={contract} />
        <MetaRelationships entity={entity} navigation={navigation} />
      </section>

      <RawContract entity={entity} />
    </div>
  );
}
