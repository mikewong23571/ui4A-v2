/**
 * application seed 常量测试(T10 Phase B Task 1;spec 架构决定 1/2/7):
 * - 三个 seed(default/publishing/community)均过 parseApplicationDefinition
 *   校验(name/title/intent 必填),default 恒在(归一化兜底,app-known 的地板);
 * - membership 方向 = flow 声明归属(架构决定 2):application 不持清单,
 *   成员从 flow.app 聚合推导;seed 名集覆盖全部 flow.app 引用——
 *   这是 app-known 的静态保证(seed 缺口会让合法 flow 提交被误拒)。
 */
import { describe, expect, it } from 'vitest';

import { parseApplicationDefinition } from '@ui4a/engine';

import {
  businessApplicationList,
  communityApplication,
  defaultApplication,
  publishingApplication,
} from './applications';
import { businessFlowList } from './flows';

describe('application seed 常量(T10)', () => {
  it('default/publishing/community 均通过 parseApplicationDefinition 校验且 intent 在场', () => {
    for (const app of businessApplicationList) {
      expect(() => parseApplicationDefinition(app)).not.toThrow();
      expect(app.title.length).toBeGreaterThan(0);
      expect(app.intent.length).toBeGreaterThan(0);
    }
    expect(businessApplicationList.map((app) => app.name)).toEqual([
      'default',
      'publishing',
      'community',
    ]);
  });

  it('default 恒在 seed 列表(归一化兜底:parse 缺省 app=default 的落点)', () => {
    expect(defaultApplication.name).toBe('default');
    expect(businessApplicationList.some((app) => app.name === 'default')).toBe(true);
  });

  it('seed 名集覆盖全部 flow.app 引用(app-known 的静态保证)', () => {
    const seeded = new Set(businessApplicationList.map((app) => app.name));
    for (const flow of businessFlowList) {
      const app = flow.app;
      expect(app, `flow "${flow.name}" 应声明归属 app`).toBeDefined();
      if (app === undefined) continue;
      expect(
        seeded.has(app),
        `flow "${flow.name}" 归属的 app "${app}" 应由 boot seed 激活`,
      ).toBe(true);
    }
  });

  it('membership 由 flow.app 聚合推导(application 不持清单):按域归组', () => {
    const membersOf = (app: string): string[] =>
      businessFlowList.filter((flow) => flow.app === app).map((flow) => flow.name);
    expect(membersOf(publishingApplication.name)).toEqual(['article-drafting', 'post-status']);
    expect(membersOf(communityApplication.name)).toEqual(['comment-moderation']);
    // default 仅作归一化兜底:现有业务 flow 全部显式归域,兜底桶为空。
    expect(membersOf(defaultApplication.name)).toEqual([]);
  });
});
