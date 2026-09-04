'use client';

import type { ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { ActivationView } from '../../activation-view';
import { CapabilityDefinitionView } from '../../capability-definition-view';
import { FlowDefinitionView } from '../../flow-definition-view';
import type { MetaNavigationContext } from '../../meta-navigation';
import { MetaRelationships, publicMetaActions, RawContract } from '../common';
import { GenericEvidenceDisclosure, GenericResponsibilityDisclosure } from './generic-disclosure';
import { genericDisclosureContract } from './generic-disclosure-contract';
import { projectGenericTask } from './generic-task-projection';

interface CanonicalSpecializationProps {
  rel: string;
  entity: SirenEntity;
  navigation: MetaNavigationContext;
  onChanged?: () => void;
}

function CanonicalSpecializedShell({
  entity,
  navigation,
  children,
}: {
  entity: SirenEntity;
  navigation: MetaNavigationContext;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      {children}
      <MetaRelationships entity={entity} navigation={navigation} />
      <RawContract entity={entity} />
    </div>
  );
}

export function FlowRenderer({ rel, entity, navigation, onChanged }: CanonicalSpecializationProps) {
  return (
    <CanonicalSpecializedShell entity={entity} navigation={navigation}>
      <FlowDefinitionView
        rel={rel}
        entity={entity}
        scope={navigation.scope}
        onChanged={onChanged}
        standalone={false}
      />
    </CanonicalSpecializedShell>
  );
}

export function ActivationRenderer({
  rel,
  entity,
  navigation,
  onChanged,
}: CanonicalSpecializationProps) {
  const id = typeof entity.properties.id === 'string' ? entity.properties.id : rel;
  const disclosure = genericDisclosureContract(entity);
  const task =
    disclosure.kind === 'declared'
      ? projectGenericTask(entity, disclosure, publicMetaActions(entity))
      : undefined;
  const responsibility =
    disclosure.kind === 'declared' && task?.hasHumanResponsibility === true ? (
      <div className="space-y-4">
        <GenericResponsibilityDisclosure
          entity={entity}
          task={task}
          rel={rel}
          scope={navigation.scope}
          onChanged={onChanged}
        />
        <GenericEvidenceDisclosure contract={disclosure} />
      </div>
    ) : undefined;
  return (
    <CanonicalSpecializedShell entity={entity} navigation={navigation}>
      <ActivationView
        id={id}
        rel={rel}
        entity={entity}
        scope={navigation.scope}
        onChanged={onChanged}
        standalone={false}
        responsibility={responsibility}
        renderActions={responsibility === undefined}
        renderProperties={responsibility === undefined}
      />
    </CanonicalSpecializedShell>
  );
}

export function CapabilityRenderer({ rel, entity, navigation }: CanonicalSpecializationProps) {
  return (
    <CanonicalSpecializedShell entity={entity} navigation={navigation}>
      <CapabilityDefinitionView rel={rel} entity={entity} standalone={false} />
    </CanonicalSpecializedShell>
  );
}
