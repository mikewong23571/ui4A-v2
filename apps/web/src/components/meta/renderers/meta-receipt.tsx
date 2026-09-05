'use client';

/**
 * G02b(T54):Meta 动作回执的稳定宿主。
 *
 * 成功回执原存于 ScopedMetaActions 的 useState——目标实体此后的读取失败
 * (如停用后 403/404)会卸载整个 renderer 树,刚取得的成功事实随之丢失。
 * 本 context 把「最后一次成功回执」提升到页面资源层(MetaEntityResource),
 * 生命周期独立于实体读取状态;按 rel 匹配展示,并明确标注为历史结果——
 * 不以临时成功快照冒充当前授权事实(D73.4)。
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import type { ActivationDisclosureView } from '../activation/activation-disclosure';

export interface MetaReceipt {
  rel: string;
  outcome: SirenEntity;
  disclosure?: ActivationDisclosureView;
}

interface MetaReceiptContextValue {
  receipt: MetaReceipt | null;
  record: (receipt: MetaReceipt) => void;
}

const noopContext: MetaReceiptContextValue = { receipt: null, record: () => undefined };

const MetaReceiptContext = createContext<MetaReceiptContextValue>(noopContext);

export function MetaReceiptProvider({ children }: { children: ReactNode }) {
  const [receipt, setReceipt] = useState<MetaReceipt | null>(null);
  return (
    <MetaReceiptContext.Provider value={{ receipt, record: setReceipt }}>
      {children}
    </MetaReceiptContext.Provider>
  );
}

/** 动作宿主记录回执(rel 绑定,离开该实体的卡片不展示他者回执)。 */
export function useMetaReceiptRecorder(rel: string): (receipt: Omit<MetaReceipt, 'rel'>) => void {
  const { record } = useContext(MetaReceiptContext);
  return (receipt) => record({ rel, ...receipt });
}

/** 稳定宿主读取:仅当回执属于当前 rel 时返回(否则 null)。 */
export function useMetaReceiptFor(rel: string): MetaReceipt | null {
  const { receipt } = useContext(MetaReceiptContext);
  return receipt !== null && receipt.rel === rel ? receipt : null;
}
