/**
 * application-lifecycle 常量(T52 Phase 3;D71.2/D71.6,TDD 红→绿)。
 *
 * 镜像 definition-lifecycle 的自举纪律:常量自身通过自身词表的语义校验
 * (validateFlowDefinition 零 issue)、exec 边可被同一台 machine 运行时校验
 * (canTransition)、JSON 往返可规范化(定义即数据)。
 * 保留名:application-lifecycle 与 definition-lifecycle 一起经
 * withLifecycleFlows 恒覆盖注入(executeMeta 裁决与 fold 重放共用)。
 */
import { describe, expect, it } from 'vitest';
import { terminalNodes } from '@ui4a/shared';

import { canTransition } from '../../core/machine';
import { parseFlowDefinition, validateFlowDefinition } from '../../core/parse';
import { APPLICATION_LIFECYCLE, APPLICATION_LIFECYCLE_FLOW } from './lifecycle';
import { DEFINITION_LIFECYCLE_FLOW, withLifecycleFlows } from '../lifecycle';

describe('application-lifecycle 常量(D71.2:active --deprecate--> deprecated)', () => {
  it('节点集与 initial:active/deprecated,initial=active(seeded 即 active)', () => {
    expect(APPLICATION_LIFECYCLE).toBe('application-lifecycle');
    expect(APPLICATION_LIFECYCLE_FLOW.name).toBe('application-lifecycle');
    expect(APPLICATION_LIFECYCLE_FLOW.initial).toBe('active');
    expect(APPLICATION_LIFECYCLE_FLOW.nodes.map((n) => n.name)).toEqual(['active', 'deprecated']);
  });

  it('deprecate 声明于 active:actor-is-human + application-not-default,requires-confirmation high,to=deprecated', () => {
    const active = APPLICATION_LIFECYCLE_FLOW.nodes.find((node) => node.name === 'active')!;
    expect(active.actions).toHaveLength(1);
    const deprecate = active.actions[0]!;
    expect(deprecate).toMatchObject({
      name: 'deprecate',
      guards: ['actor-is-human', 'application-not-default'],
      'requires-confirmation': 'high',
      to: 'deprecated',
    });
  });

  it('reason 可选(textarea / semantics intent,无 required / minLength):停用理由留痕不设门槛', () => {
    const deprecate = APPLICATION_LIFECYCLE_FLOW.nodes[0]!.actions[0]!;
    expect(deprecate.fields).toEqual([{ name: 'reason', type: 'textarea', semantics: 'intent' }]);
  });

  it('deprecated 节点零动作(终态审计视图;第二次 deprecate 即 stale)', () => {
    const deprecated = APPLICATION_LIFECYCLE_FLOW.nodes.find((node) => node.name === 'deprecated')!;
    expect(deprecated.actions).toEqual([]);
  });

  it('exec 边可迁移(同一台 machine 运行时);deprecated 是 terminal', () => {
    expect(canTransition(APPLICATION_LIFECYCLE_FLOW, 'active', 'deprecated')).toBe(true);
    expect(terminalNodes(APPLICATION_LIFECYCLE_FLOW)).toEqual(['deprecated']);
  });

  it('自举:常量通过自身词表的语义校验(validateFlowDefinition 零 issue)', () => {
    expect(validateFlowDefinition(APPLICATION_LIFECYCLE_FLOW)).toEqual([]);
  });

  it('自举:常量 JSON 往返后可被 parseFlowDefinition 规范化(定义即数据)', () => {
    const parsed = parseFlowDefinition(JSON.parse(JSON.stringify(APPLICATION_LIFECYCLE_FLOW)));
    expect(parsed.name).toBe('application-lifecycle');
    expect(parsed.nodes).toHaveLength(2);
  });
});

describe('保留名注入(withLifecycleFlows 同时携带两个 lifecycle 常量)', () => {
  it('恒覆盖注册表同名项(业务定义不能冒名顶替自己的裁决器)', () => {
    const impostor = { ...APPLICATION_LIFECYCLE_FLOW, title: '冒名顶替' };
    const flows = withLifecycleFlows({ 'application-lifecycle': impostor });
    expect(flows['application-lifecycle']).toBe(APPLICATION_LIFECYCLE_FLOW);
    expect(flows['definition-lifecycle']).toBe(DEFINITION_LIFECYCLE_FLOW);
  });

  it('调用方自带的其他 flow 原样透传', () => {
    const flows = withLifecycleFlows({
      'post-status': { ...DEFINITION_LIFECYCLE_FLOW, name: 'post-status' },
    });
    expect(Object.keys(flows)).toEqual(
      expect.arrayContaining(['post-status', 'definition-lifecycle', 'application-lifecycle']),
    );
  });
});
