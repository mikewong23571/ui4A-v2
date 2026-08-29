'use client';
/**
 * member-card 词条(T33 Phase D / D50 责任点一等):集合成员携带已声明动作时,
 * 成员渲染为决策卡——身份行(人话 identity)+ 合同标识 + 统一动作组
 * (ActionGroup:收起触发键、guard 投影、人/AI 同权图例)。
 *
 * 输入全部来自成员合同的逐行 item 解引用(label/rel/actions/guard-results/
 * properties.fields);动作经宿主 ActionSubmitProvider 提交,同一裁决器,
 * 零实体类型分支。成员无动作时只有身份行(渲染器零分支)。
 */
import type { SirenEntity } from '@ui4a/engine';

import { canvasEntityHref } from '@/presence/navigation';

import { ActionGroup } from '../../components/actions/action-group';

import {
  asOptionalActions,
  asOptionalFields,
  asOptionalGuardResults,
  asOptionalString,
  asRequiredString,
  type WordProps,
} from './shared';

export function MemberCardWord(props: WordProps) {
  const label = asRequiredString(props.label, 'member-card', 'label');
  const rel = asRequiredString(props.rel, 'member-card', 'rel');
  const status = asOptionalString(props.status, 'member-card', 'status');
  const detail = asOptionalString(props.detail, 'member-card', 'detail');
  const actions = asOptionalActions(props.actions, 'member-card', 'actions');
  const guardResults = asOptionalGuardResults(props.guardResults, 'member-card', 'guardResults');
  const fields = asOptionalFields(props.fields, 'member-card', 'fields');

  // 决策卡只消费动作裁决所需的最小合同面;标识与预填取值来自成员投影。
  const entity: SirenEntity = {
    class: ['presentation-member-card'],
    properties: { rel, ...(fields === undefined ? {} : { fields }) },
    actions,
    links: [],
    'guard-results': guardResults,
  };

  return (
    <article
      data-word="member-card"
      data-rel={rel}
      className="w-full rounded-lg border bg-card p-3 text-card-foreground"
    >
      {/* 标题行保持成员导航(合同 href → 画布落面),动作行承载责任点 */}
      <a
        data-nav="presentation:member"
        href={canvasEntityHref(rel)}
        className="block text-sm font-medium text-foreground hover:text-primary hover:underline"
      >
        {label}
      </a>
      {detail !== undefined && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
        {status !== undefined ? `${status} · ` : ''}
        {rel}
      </p>
      {actions.length > 0 && (
        <section aria-label="动作" className="mt-2">
          <ActionGroup entity={entity} />
        </section>
      )}
    </article>
  );
}
