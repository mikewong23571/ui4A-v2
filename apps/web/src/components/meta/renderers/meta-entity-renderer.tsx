'use client';

import type { SirenEntity } from '@ui4a/engine';

import { AgentDefinitionRenderer } from './agent-definition-renderer';
import { ApplicationRenderer } from './application-renderer';
import {
  ActivationRenderer,
  CapabilityRenderer,
  FlowRenderer,
} from './canonical-specialized-renderer';
import { DraftRenderer } from './draft-renderer';
import { GenericMetaRenderer } from './generic-renderer';
import { createMetaRendererRegistry } from './registry';

const registry = createMetaRendererRegistry([
  { id: 'application', priority: 100, classes: ['application-definition'] },
  { id: 'agent-definition', priority: 100, classes: ['agent-definition'] },
  { id: 'draft', priority: 200, classes: ['draft'] },
  { id: 'flow', priority: 100, classes: ['flow-definition'] },
  { id: 'activation', priority: 100, classes: ['activation'] },
  { id: 'capability', priority: 100, classes: ['capability-definition'] },
]);

export function MetaEntityRenderer({
  rel,
  entity,
  scope,
  descriptorTitle,
  onChanged,
}: {
  rel?: string;
  entity: SirenEntity;
  scope?: string;
  descriptorTitle?: string;
  onChanged?: () => void;
}) {
  const renderer = registry.resolve(entity);
  if (renderer === 'application') return <ApplicationRenderer entity={entity} scope={scope} />;
  if (renderer === 'agent-definition')
    return <AgentDefinitionRenderer entity={entity} scope={scope} />;
  if (renderer === 'draft')
    return <DraftRenderer entity={entity} scope={scope} onChanged={onChanged} />;
  if (renderer === 'flow')
    return <FlowRenderer rel={rel ?? ''} entity={entity} scope={scope} onChanged={onChanged} />;
  if (renderer === 'activation')
    return (
      <ActivationRenderer rel={rel ?? ''} entity={entity} scope={scope} onChanged={onChanged} />
    );
  if (renderer === 'capability')
    return <CapabilityRenderer rel={rel ?? ''} entity={entity} scope={scope} />;
  return (
    <GenericMetaRenderer
      entity={entity}
      rel={rel}
      scope={scope}
      descriptorTitle={descriptorTitle}
      onChanged={onChanged}
    />
  );
}
