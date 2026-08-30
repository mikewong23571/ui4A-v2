'use client';

import type { ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { ActivationView } from '../activation-view';
import { CapabilityDefinitionView } from '../capability-definition-view';
import { FlowDefinitionView } from '../flow-definition-view';
import { MetaRelationships, RawContract } from './common';

interface CanonicalSpecializationProps {
  rel: string;
  entity: SirenEntity;
  scope?: string;
  onChanged?: () => void;
}

function CanonicalSpecializedShell({
  entity,
  scope,
  children,
}: {
  entity: SirenEntity;
  scope?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {children}
      <MetaRelationships entity={entity} scope={scope} />
      <RawContract entity={entity} />
    </div>
  );
}

export function FlowRenderer({ rel, entity, scope, onChanged }: CanonicalSpecializationProps) {
  return (
    <CanonicalSpecializedShell entity={entity} scope={scope}>
      <FlowDefinitionView
        rel={rel}
        entity={entity}
        scope={scope}
        onChanged={onChanged}
        standalone={false}
      />
    </CanonicalSpecializedShell>
  );
}

export function ActivationRenderer({
  rel,
  entity,
  scope,
  onChanged,
}: CanonicalSpecializationProps) {
  const id = typeof entity.properties.id === 'string' ? entity.properties.id : rel;
  return (
    <CanonicalSpecializedShell entity={entity} scope={scope}>
      <ActivationView
        id={id}
        rel={rel}
        entity={entity}
        scope={scope}
        onChanged={onChanged}
        standalone={false}
      />
    </CanonicalSpecializedShell>
  );
}

export function CapabilityRenderer({ rel, entity, scope }: CanonicalSpecializationProps) {
  return (
    <CanonicalSpecializedShell entity={entity} scope={scope}>
      <CapabilityDefinitionView rel={rel} entity={entity} standalone={false} />
    </CanonicalSpecializedShell>
  );
}
