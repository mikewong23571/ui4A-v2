import type { SirenAction, SirenEntity, SirenLink } from '@ui4a/engine';

import { isRecord, text } from './value';

export interface DraftResponsibilityLink {
  href: string;
  title: string;
}

export interface DraftReviewResponsibility {
  state: 'ready' | 'invalid' | 'stale' | 'review';
  title: string;
  description: string;
  actions: string[];
  repairLink?: DraftResponsibilityLink;
}

function publicAction(action: SirenAction): boolean {
  return action.href === '/_meta/api/exec' && !action.name.includes('callback');
}

function responsibilityActionLabel(action: SirenAction): string {
  return action.title.trim() || action.name;
}

function repairLink(links: SirenLink[]): DraftResponsibilityLink | undefined {
  const candidates = links.filter(
    (link) => link.rel.includes('author') || link.rel.includes('source'),
  );
  const selected =
    candidates.find((link) => link.title !== undefined && link.rel.includes('author')) ??
    candidates.find((link) => link.title !== undefined) ??
    candidates.find((link) => link.rel.includes('author')) ??
    candidates[0];
  if (selected === undefined) return undefined;
  return {
    href: selected.href,
    title: selected.title?.trim() || selected.rel.join(' · '),
  };
}

function nextActions(actions: string[]): string {
  return actions.length === 0
    ? '当前合同未声明可操作动作。'
    : `当前声明动作：${actions.join('、')}。`;
}

export function draftReviewResponsibility(entity: SirenEntity): DraftReviewResponsibility {
  const properties = entity.properties;
  const status = text(properties.status);
  const validation = isRecord(properties.validation) ? properties.validation : {};
  const actions = entity.actions.filter(publicAction).map(responsibilityActionLabel);
  const link = repairLink(entity.links);

  if (status === 'invalid') {
    return {
      state: 'invalid',
      title: '候选需要修复',
      description: `保留当前问题、差异与来源现场；可返回候选作者，或将问题交给 Assistant 继续修复。${nextActions(actions)}`,
      actions,
      ...(link === undefined ? {} : { repairLink: link }),
    };
  }

  if (status === 'stale') {
    const baseVersion = text(properties.baseVersion);
    const reason = text(properties.terminalReason);
    const conflict =
      reason ||
      (baseVersion === ''
        ? '当前基线与定义版本冲突。'
        : `base ${baseVersion} 与当前定义版本冲突。`);
    return {
      state: 'stale',
      title: '候选基线已过期',
      description: `${conflict} 保留候选 payload 与 provenance；仅通过当前合同声明的动作重试。${nextActions(actions)}`,
      actions,
      ...(link === undefined ? {} : { repairLink: link }),
    };
  }

  if (status === 'ready' || (status === '' && validation.valid === true)) {
    return {
      state: 'ready',
      title: '候选已通过校验',
      description: `下一步由当前 Draft 合同决定。${nextActions(actions)}`,
      actions,
    };
  }

  return {
    state: 'review',
    title: '候选等待审查',
    description: `当前状态：${status || '未声明'}。${nextActions(actions)}`,
    actions,
  };
}
