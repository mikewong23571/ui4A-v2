'use client';

import type { SirenEntity } from '@ui4a/engine';

import { metaNavigationContext, type MetaNavigationContext } from '../meta-navigation';

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
  navigation = {},
  descriptorTitle,
  onChanged,
}: {
  rel?: string;
  entity: SirenEntity;
  navigation?: MetaNavigationContext;
  descriptorTitle?: string;
  onChanged?: () => void;
}) {
  const parsedNavigation = metaNavigationContext(navigation);
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
  if (renderer === 'application')
    return <ApplicationRenderer entity={entity} navigation={parsedNavigation} />;
  if (renderer === 'agent-definition')
    return <AgentDefinitionRenderer entity={entity} navigation={parsedNavigation} />;
  if (renderer === 'draft')
    return <DraftRenderer entity={entity} navigation={parsedNavigation} onChanged={onChanged} />;
  if (renderer === 'flow')
    return (
      <FlowRenderer
        rel={rel ?? ''}
        entity={entity}
        navigation={parsedNavigation}
        onChanged={onChanged}
      />
    );
  if (renderer === 'activation')
    return (
      <ActivationRenderer
        rel={rel ?? ''}
        entity={entity}
        navigation={parsedNavigation}
        onChanged={onChanged}
      />
    );
  if (renderer === 'capability')
    return <CapabilityRenderer rel={rel ?? ''} entity={entity} navigation={parsedNavigation} />;
  return (
    <GenericMetaRenderer
      entity={entity}
      rel={rel}
      navigation={parsedNavigation}
      descriptorTitle={descriptorTitle}
      onChanged={onChanged}
    />
  );
}
