'use client';

import type { SirenEntity } from '@ui4a/engine';
import { useId, useState } from 'react';

import { Button } from '../ui/button';

export interface RawContractContentProps {
  entity: SirenEntity;
}

/** Exact authorized Siren JSON. This lens never fetches, hydrates, or assembles facts. */
export function RawContractContent({ entity }: RawContractContentProps) {
  return (
    <pre data-testid="raw-contract-json" className="whitespace-pre-wrap break-all">
      {JSON.stringify(entity, null, 2)}
    </pre>
  );
}

export interface RawContractDrawerProps {
  /** Undefined for virtual or unavailable subjects: no business contract may be invented. */
  entity: SirenEntity | undefined;
}

/** Local verification lens. Raw is deliberately a drawer, never a route or site mode. */
export function RawContractDrawer({ entity }: RawContractDrawerProps) {
  const [open, setOpen] = useState(false);
  const panelId = `raw-contract-${useId().replace(/:/g, '')}`;

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-nav="local:raw-contract"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={entity === undefined}
        onClick={() => setOpen((current) => !current)}
      >
        查看原始合同
      </Button>
      {open && entity !== undefined && (
        <aside
          id={panelId}
          aria-label="原始合同"
          className="mt-3 space-y-3 rounded-md border bg-muted/20 p-4 text-xs text-muted-foreground"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">原始合同</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-nav="local:raw-contract-close"
              onClick={() => setOpen(false)}
            >
              关闭原始合同
            </Button>
          </div>
          <RawContractContent entity={entity} />
        </aside>
      )}
    </div>
  );
}
