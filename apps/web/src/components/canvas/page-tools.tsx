'use client';
/**
 * 页面次要工具入口(T56 D78/design §1):重新载入、「为什么这样展示」与
 * 「原始合同」收进同一入口,最多两步可达;默认收起,机制词不上首屏。
 * 审批证据不在此收口——责任与决定回执在 surface 的声明动作区(FR6)。
 */
import { useState } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { Button } from '../ui/button';
import { CanvasWhyDrawer, type CanvasWhyDrawerProps } from './canvas-why-drawer';
import { RawContractDrawer } from './raw-contract-drawer';

interface CanvasPageToolsProps {
  /** 载入进行中禁用重新载入(与原常显按钮同一语义)。 */
  loading: boolean;
  onReload: () => void;
  /** 主 focus 的原始合同(虚主体/不可解析时 undefined,按钮禁用)。 */
  rawEntity: SirenEntity | undefined;
  /** 「为什么这样展示」抽屉的全部输入(与宿主内部状态同源平铺)。 */
  why: CanvasWhyDrawerProps;
}

/** 二步可达的机制工具面板;保持自持开合,关闭即卸载(零机制词泄漏)。 */
export function CanvasPageTools({ loading, onReload, rawEntity, why }: CanvasPageToolsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-nav="local:canvas-tools"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        页面工具
      </Button>
      {open && (
        <div
          data-testid="canvas-page-tools-panel"
          className="absolute right-0 top-full z-40 mt-2 flex max-h-[70dvh] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-nav="local:canvas-reload"
              disabled={loading}
              onClick={onReload}
            >
              重新载入
            </Button>
          </div>
          <CanvasWhyDrawer {...why} />
          <RawContractDrawer entity={rawEntity} />
        </div>
      )}
    </div>
  );
}
