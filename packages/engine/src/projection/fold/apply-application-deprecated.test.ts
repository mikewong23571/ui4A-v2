/**
 * application-deprecated(T52 Phase 1;D71.1)fold 级联重放:
 * 受治理的应用停用事件 —— ① applications 删除该 name 键(停用即出局)、
 * ② deprecatedApplications 审计集留痕(name + 可选 reason + 事件 seq;纯层
 * 无时钟,序号用 seq)、③ definitions 中 app === name 的条目级联置
 * status:'deprecated'(app-known 不变式因此保持成立)。
 *
 * 纪律与既有 fold 事件族同口径:幂等(同一事件重复 fold 防御性幂等,
 * 参照 applyApplicationSeeded 首写为准)、缺载荷响亮失败、I5 口径
 * (全 log 折叠两次 / 分段折叠结果一致)。
 */
import { describe, expect, it } from 'vitest';

import type { ApplicationDefinition } from '@ui4a/shared';

import { contentVersion } from '../../contract/sitemap';
import { definitionSeedEvent } from '../../definition/meta';
import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
} from '../../core/fixtures';
import { fold, type LogEvent } from './index';

const flows = flowRegistry(commentModerationFlow, postStatusFlow, articleDraftingFlow);

const defaultApp: ApplicationDefinition = {
  name: 'default',
  title: '默认应用',
  intent: '无归属 flow 的兜底归组',
};

const publishingApp: ApplicationDefinition = {
  name: 'publishing',
  title: '内容发布',
  intent: '内容起草与发布',
};

/** application-seeded 日志事件(boot 装载形状;detail 持定义全文)。 */
function applicationSeedEvent(seq: number, app: ApplicationDefinition): LogEvent {
  return {
    seq,
    kind: 'application-seeded',
    rel: `meta/application:${app.name}`,
    detail: { name: app.name, definition: app },
  };
}

/** application-deprecated 日志事件(D71.2:APPLICATION_LIFECYCLE 宿主 deprecate
 *  动作的伴随事件形状;detail = name/reason?/commandId)。 */
function applicationDeprecatedEvent(
  seq: number,
  name: string,
  options?: { reason?: string },
): LogEvent {
  return {
    seq,
    kind: 'application-deprecated',
    rel: `meta/application:${name}`,
    action: 'deprecate',
    actor: 'human',
    principal: 'user:mike',
    detail: {
      name,
      commandId: 'cmd:t52-deprecate',
      ...(options?.reason !== undefined ? { reason: options.reason } : {}),
    },
  };
}

/** 完整场景日志:两 app 种子 + publishing 专属 flow + default flow + 停用 publishing。 */
const fullLog: LogEvent[] = [
  applicationSeedEvent(1, defaultApp),
  applicationSeedEvent(2, publishingApp),
  definitionSeedEvent(3, { ...postStatusFlow, app: 'publishing' }),
  definitionSeedEvent(4, commentModerationFlow), // app 缺省 → 'default'
  applicationDeprecatedEvent(5, 'publishing', { reason: '走查残留清理' }),
];

describe('fold — application-deprecated(T52/D71.1)', () => {
  it('级联①:applications 删除该 name 键(停用即出局,其余 app 不动)', () => {
    const snapshot = fold(fullLog, { flows });

    expect(snapshot.applications).toEqual({ default: defaultApp });
  });

  it('级联②:deprecatedApplications 审计集留痕(name + 可选 reason + 事件 seq)', () => {
    const snapshot = fold(fullLog, { flows });

    expect(snapshot.deprecatedApplications).toEqual({
      publishing: { name: 'publishing', reason: '走查残留清理', seq: 5 },
    });

    // reason 可选:无理由停用的审计条目不携带 reason。
    const unreasoned = fold([...fullLog.slice(0, 4), applicationDeprecatedEvent(5, 'publishing')], {
      flows,
    });
    expect(unreasoned.deprecatedApplications).toEqual({
      publishing: { name: 'publishing', seq: 5 },
    });
  });

  it('级联③:definitions 中 app===name 的条目置 deprecated,其余 app 条目不动', () => {
    const before = fold(fullLog.slice(0, 4), { flows });
    const snapshot = fold(fullLog, { flows });

    expect(snapshot.definitions?.['post-status']?.status).toBe('deprecated');
    // 仅状态置废:版本与定义全文保留(审计可见,不删除)。
    expect(snapshot.definitions?.['post-status']?.version).toBe(1);
    expect(snapshot.definitions?.['post-status']?.definition).toEqual(
      before.definitions?.['post-status']?.definition,
    );
    // 不同 app 的条目不受级联影响。
    expect(snapshot.definitions?.['comment-moderation']?.status).toBe('active');
  });

  it('app 归一化口径:app 缺省的条目按 default 参与级联(与 app-known 检查同口径)', () => {
    const snapshot = fold(
      [
        definitionSeedEvent(1, commentModerationFlow), // app 缺省 → 'default'
        applicationDeprecatedEvent(2, 'default'),
      ],
      { flows },
    );

    expect(snapshot.definitions?.['comment-moderation']?.status).toBe('deprecated');
    // 无 application-seeded 的日志:applications 表保持缺省不物化
    //(与 applications「仅在场时携带」同口径,不因停用事件物化空表)。
    expect(snapshot.applications).toBeUndefined();
    expect(snapshot.deprecatedApplications).toEqual({
      default: { name: 'default', seq: 2 },
    });
  });

  it('幂等:同一事件重复 fold 不改变快照(审计首写为准,参照 applyApplicationSeeded)', () => {
    const once = fold(fullLog, { flows });
    // 重复停用(不同 seq/理由)不覆盖先到的审计留痕,也不重复扰动其余表。
    const twice = fold(
      [...fullLog, applicationDeprecatedEvent(9, 'publishing', { reason: '第二次(防御性重放)' })],
      { flows },
    );

    expect(twice).toEqual(once);
  });

  it('增量 fold(initial 携带 deprecatedApplications):审计表随行不丢(web 读路径的根基)', () => {
    const base = fold(fullLog, { flows });
    const continued = fold(
      [definitionSeedEvent(6, { ...articleDraftingFlow, app: 'default' })],
      { flows },
      base,
    );

    expect(continued.deprecatedApplications).toEqual({
      publishing: { name: 'publishing', reason: '走查残留清理', seq: 5 },
    });
    expect(continued.definitions?.['article-drafting']?.status).toBe('active');
    expect(continued.definitions?.['post-status']?.status).toBe('deprecated');
  });

  it('停用后折叠业务 seed 事件:deprecatedApplications 表随行不丢(applySeed 携带口径)', () => {
    const lateSeed: LogEvent = {
      seq: 6,
      kind: 'seed',
      detail: {
        instances: {
          'comment:c1': {
            rel: 'comment:c1',
            flow: 'comment-moderation',
            node: 'pending',
            fields: {},
          },
        },
      },
    };

    const snapshot = fold([...fullLog, lateSeed], { flows });

    expect(snapshot.instances['comment:c1']?.node).toBe('pending');
    expect(snapshot.deprecatedApplications).toEqual({
      publishing: { name: 'publishing', reason: '走查残留清理', seq: 5 },
    });
  });

  it('I5:混入 application-seeded/definition-seeded 的完整 log 折叠两次/分段折叠结果一致', () => {
    const log: LogEvent[] = [
      ...fullLog,
      definitionSeedEvent(6, { ...articleDraftingFlow, app: 'default' }),
    ];
    const whole = fold(log, { flows });

    // 全 log 折叠两次一致(纯函数确定性)。
    expect(fold(log, { flows })).toEqual(whole);
    // 分段折叠一致:种子(1-4)→ 停用(5)→ 后置 definition-seeded(6)。
    const first = fold(log.slice(0, 4), { flows });
    const second = fold(log.slice(4, 5), { flows }, first);
    const third = fold(log.slice(5), { flows }, second);

    expect(third).toEqual(whole);
    expect(contentVersion(third)).toBe(contentVersion(whole));
  });

  it('缺少 detail 载荷(name/commandId)→ 响亮失败并带 seq(日志完整性)', () => {
    const bogus: LogEvent = {
      seq: 7,
      kind: 'application-deprecated',
      rel: 'meta/application:x',
      action: 'deprecate',
      actor: 'human',
    };
    const noCommandId: LogEvent = {
      seq: 8,
      kind: 'application-deprecated',
      rel: 'meta/application:x',
      action: 'deprecate',
      actor: 'human',
      detail: { name: 'x' },
    };

    expect(() => fold([bogus], { flows })).toThrow(/seq=7 application-deprecated 缺少 detail 载荷/);
    expect(() => fold([noCommandId], { flows })).toThrow(
      /seq=8 application-deprecated 缺少 detail 载荷/,
    );
  });
});
