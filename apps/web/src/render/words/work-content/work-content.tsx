'use client';

import { ActionGroup, isThreadMaterialAttach } from '../../../components/actions/action-group';
import { referenceOptions } from '../../../components/actions/reference-selection';
import { relOf } from '../../../components/canvas/desk/thread-desk-shared';
import { Button } from '../../../components/ui/button';
import { hrefToRel } from '../../../components/contract-href';
import { DetailWord } from '../detail';
import { asEntity, asMembers, asOptionalLinks, type WordProps } from '../shared';
import { MaterialDialog } from './material-dialog';
import { splitWorkMembers } from './work-content-data';
import { WorkMember } from './work-member';
import { useWorkRoot } from './use-work-root';

/** Work and responsibilities keep the stage; supporting context is an optional local task. */
export function WorkContentWord(props: WordProps) {
  const boundEntity = asEntity(props.entity, 'work-content', 'entity');
  const entities = asMembers(props.entities, 'work-content', 'entities');
  const root = useWorkRoot(boundEntity, entities);
  const entity = root.entity;
  const links = root.refreshed
    ? entity.links
    : asOptionalLinks(props.links, 'work-content', 'links');
  const { work, materials, responsibilities } = splitWorkMembers(root.members);
  const materialRels = new Set(materials.map(relOf));
  const rel = relOf(entity);
  const secondaryLinks = links.filter(
    (link) => !materialRels.has(hrefToRel(link.href) ?? '') && !link.rel.includes('self'),
  );
  const management = entity.actions.filter((action) => {
    if (isThreadMaterialAttach(rel, action)) return false;
    const options = referenceOptions(action);
    return (
      options === undefined ||
      options.some(
        (option) => typeof option.params.rel !== 'string' || !materialRels.has(option.params.rel),
      )
    );
  });
  return (
    <section data-word="work-content" data-testid="work-content" className="min-w-0 w-full">
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1 border-b border-border/60 pb-2">
        <MaterialDialog
          entity={entity}
          materials={materials}
          unavailable={root.unavailable}
          loading={root.loading}
          onRefresh={root.refresh}
        />
        {management.length > 0 && (
          <ActionGroup
            entity={{ ...entity, actions: management }}
            posture="disclosure"
            formHost="dialog"
            density="compact"
          />
        )}
      </div>
      {root.unavailable && (
        <div className="flex items-center gap-3 py-4">
          <p role="alert" className="text-sm text-muted-foreground">
            暂时无法读取
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void root.refresh()}>
            重试
          </Button>
        </div>
      )}
      {responsibilities.map((member) => (
        <WorkMember key={relOf(member)} member={member} responsibility />
      ))}
      {work.map((member) => (
        <WorkMember key={relOf(member)} member={member} />
      ))}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-nav="local:open-chat"
          onClick={(event) =>
            window.dispatchEvent(new CustomEvent('ui4a:chat-open', { detail: event.currentTarget }))
          }
        >
          讨论
        </Button>
        {secondaryLinks.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">活动与依据</summary>
            <div className="pt-2">
              <DetailWord entity={{ ...entity, links: secondaryLinks, actions: [] }} mode="links" />
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
