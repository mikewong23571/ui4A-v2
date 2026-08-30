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
import { createMetaRendererRegistry, META_RENDERER_REGISTRATIONS } from './registry';

const registry = createMetaRendererRegistry(META_RENDERER_REGISTRATIONS);

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
  let renderer;
  try {
    renderer = registry.resolve(entity);
  } catch {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 p-6">
        <h1 className="text-xl font-semibold">合同类型冲突</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          当前实体同时匹配多个 Meta Renderer。为避免错误展示，系统已停止渲染；原始实体未被修改。
        </p>
      </div>
    );
  }
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
