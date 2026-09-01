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

import { cn } from '@/lib/utils';
import { canvasEntityHref } from '@/presence/navigation';

import { ActionGroup } from '../../components/actions/action-group';

import {
  asOptionalActions,
  asOptionalFields,
  asOptionalGuardResults,
  asOptionalPresentations,
  asOptionalString,
  asRequiredString,
  type WordProps,
} from './shared';
import { declaredMemberOverview } from './member-overview';

export function MemberCardWord(props: WordProps) {
  const label = asRequiredString(props.label, 'member-card', 'label');
  const rel = asRequiredString(props.rel, 'member-card', 'rel');
  const status = asOptionalString(props.status, 'member-card', 'status');
  const detail = asOptionalString(props.detail, 'member-card', 'detail');
  const actions = asOptionalActions(props.actions, 'member-card', 'actions');
  const guardResults = asOptionalGuardResults(props.guardResults, 'member-card', 'guardResults');
  const fields = asOptionalFields(props.fields, 'member-card', 'fields');
  const presentations = asOptionalPresentations(
    props.presentations,
    'member-card',
    'presentations',
  );
  const overview = declaredMemberOverview(presentations, fields);
  // 用户级密度偏好(T38 疏密贯通):compact 收紧卡片留白与行距、detail 单行
  // 截断;comfortable/spacious 保持既有排版(容器留白由宿主另行处理)。
  const density = asOptionalString(props.density, 'member-card', 'density');
  const compact = density === 'compact';

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
      data-density={density}
      className={cn(
        'w-full rounded-lg border bg-card text-card-foreground',
        compact ? 'p-1.5' : 'p-3',
      )}
    >
      {/* 标题行保持成员导航(合同 href → 画布落面),动作行承载责任点 */}
      <a
        data-nav="presentation:member"
        href={canvasEntityHref(rel)}
        className={cn(
          'block text-sm font-medium text-foreground hover:text-primary hover:underline',
          compact && 'truncate',
        )}
      >
        {label}
      </a>
      {detail !== undefined && (
        <p className={cn('text-xs text-muted-foreground', compact ? 'mt-0 truncate' : 'mt-0.5')}>
          {detail}
        </p>
      )}
      <p
        className={cn(
          'font-mono text-xs text-muted-foreground',
          compact ? 'mt-0 truncate' : 'mt-0.5',
        )}
      >
        {status !== undefined ? `${status} · ` : ''}
        {rel}
      </p>
      {overview.length > 0 && (
        <div className={cn(compact ? 'mt-1 space-y-0.5' : 'mt-2 space-y-2')}>
          {overview.map(({ presentation, value }) => (
            <div key={presentation.path} data-column={presentation.path}>
              <p className="text-[11px] font-medium text-muted-foreground">{presentation.title}</p>
              {value !== undefined && (
                <p
                  className={cn(
                    'whitespace-pre-wrap break-words text-sm text-foreground',
                    compact ? 'leading-5' : 'leading-6',
                  )}
                >
                  {value}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <section aria-label="动作" className={compact ? 'mt-1' : 'mt-2'}>
          <ActionGroup entity={entity} />
        </section>
      )}
    </article>
  );
}
