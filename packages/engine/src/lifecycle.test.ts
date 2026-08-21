/**
 * definition-lifecycle 常量(T4 Phase A Task 1,TDD 红→绿)。
 *
 * A.4 原样(arch-brief §10):
 *   draft --submit--> validating
 *   validating --checks-pass--> pending-approval / --checks-fail--> draft(附校验报告)
 *   pending-approval --approve--> active / --reject--> rejected
 *   active --revise--> draft(v+1) / --deprecate--> deprecated
 * T4 非目标:pending-approval --timeout--> expired(时钟 capability,后续)。
 * 自举断言:该常量自身通过自身词表的语义校验(validateFlowDefinition),
 * 且其编辑动词可用同一台 machine 运行时(canTransition)校验转移。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFINITION_LIFECYCLE,
  DEFINITION_LIFECYCLE_FLOW,
  LIFECYCLE_INTERNAL_EDGES,
} from './lifecycle';
import { canTransition } from './machine';
import { parseFlowDefinition, validateFlowDefinition } from './parse';
import { terminalNodes } from '@ui4a/shared';

function node(name: string) {
  const found = DEFINITION_LIFECYCLE_FLOW.nodes.find((candidate) => candidate.name === name);
  expect(found, `节点 "${name}" 应存在于 lifecycle 常量`).toBeDefined();
  return found!;
}

function action(nodeName: string, actionName: string) {
  const found = node(nodeName).actions.find((candidate) => candidate.name === actionName);
  expect(found, `动作 "${actionName}" 应声明于节点 "${nodeName}"`).toBeDefined();
  return found!;
}

describe('definition-lifecycle 常量(A.4 原样,timeout/expired 除外)', () => {
  it('节点集与 initial:draft/validating/pending-approval/active/rejected/deprecated,initial=draft', () => {
    expect(DEFINITION_LIFECYCLE_FLOW.name).toBe('definition-lifecycle');
    expect(DEFINITION_LIFECYCLE_FLOW.initial).toBe('draft');
    expect(DEFINITION_LIFECYCLE_FLOW.nodes.map((n) => n.name)).toEqual([
      'draft',
      'validating',
      'pending-approval',
      'active',
      'rejected',
      'deprecated',
    ]);
    expect(DEFINITION_LIFECYCLE).toBe('definition-lifecycle');
  });

  it('A.4 的 exec 边均可迁移(submit/approve/reject/revise/deprecate)', () => {
    expect(canTransition(DEFINITION_LIFECYCLE_FLOW, 'draft', 'validating')).toBe(true);
    expect(canTransition(DEFINITION_LIFECYCLE_FLOW, 'pending-approval', 'active')).toBe(true);
    expect(canTransition(DEFINITION_LIFECYCLE_FLOW, 'pending-approval', 'rejected')).toBe(true);
    expect(canTransition(DEFINITION_LIFECYCLE_FLOW, 'active', 'draft')).toBe(true);
    expect(canTransition(DEFINITION_LIFECYCLE_FLOW, 'active', 'deprecated')).toBe(true);
  });

  it('timeout/expired 不存在(T4 非目标:时钟 capability)', () => {
    expect(DEFINITION_LIFECYCLE_FLOW.nodes.some((n) => n.name === 'expired')).toBe(false);
    const allActions = DEFINITION_LIFECYCLE_FLOW.nodes.flatMap((n) => n.actions.map((a) => a.name));
    expect(allActions).not.toContain('timeout');
  });

  it('编辑动词声明在 draft 节点,guard 集与 A.3 一致(add-node/add-action/submit)', () => {
    expect(action('draft', 'add-node').guards).toEqual(['is-draft', 'node-not-exists']);
    expect(action('draft', 'add-action').guards).toEqual([
      'is-draft',
      'node-exists',
      'to-exists',
      'guards-registered',
      'effect-known',
      'action-not-exists',
    ]);
    expect(action('draft', 'submit').guards).toEqual(['is-draft']);
  });

  it('add-node/add-action 的效果是 meta-edit(对 definition 工作副本的结构性效果)', () => {
    expect(action('draft', 'add-node').effect).toEqual([{ type: 'meta-edit', op: 'add-node' }]);
    expect(action('draft', 'add-action').effect).toEqual([{ type: 'meta-edit', op: 'add-action' }]);
  });

  it('add-action 的参数 schema:node 必填,action(action-definition 全文)必填为 json 字段', () => {
    const fields = action('draft', 'add-action').fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['node', 'action']);
    expect(fields[0]).toMatchObject({ name: 'node', type: 'text', required: true });
    expect(fields[1]).toMatchObject({ name: 'action', type: 'json', required: true });
  });

  it('approve/reject 声明于 pending-approval:actor-is-human(铁律 5),reject 的 reason 必填且非空', () => {
    expect(action('pending-approval', 'approve').guards).toEqual(['actor-is-human']);
    expect(action('pending-approval', 'reject').guards).toEqual(['actor-is-human']);
    expect(action('pending-approval', 'reject').fields).toEqual([
      { name: 'reason', type: 'textarea', required: true, minLength: 1, semantics: 'intent' },
    ]);
  });

  it('active 节点:revise(is-active)/deprecate(no-live-instances)', () => {
    expect(action('active', 'revise').guards).toEqual(['is-active']);
    expect(action('active', 'deprecate').guards).toEqual(['no-live-instances']);
  });

  it('validating 无 exec 动作(checks-pass/checks-fail 是引擎内转移,不是动词)', () => {
    expect(node('validating').actions).toEqual([]);
  });

  it('自举:常量通过自身词表的语义校验(validateFlowDefinition 零 issue)', () => {
    expect(validateFlowDefinition(DEFINITION_LIFECYCLE_FLOW)).toEqual([]);
  });

  it('自举:常量 JSON 往返后可被 parseFlowDefinition 规范化(定义即数据)', () => {
    const parsed = parseFlowDefinition(JSON.parse(JSON.stringify(DEFINITION_LIFECYCLE_FLOW)));
    expect(parsed.name).toBe('definition-lifecycle');
    expect(parsed.nodes).toHaveLength(6);
  });
});

describe('lifecycle 内部转移与 terminal 推导', () => {
  it('checks-pass/checks-fail 声明为引擎内边(validating→pending-approval / validating→draft)', () => {
    expect(LIFECYCLE_INTERNAL_EDGES).toEqual([
      { from: 'validating', action: 'checks-pass', to: 'pending-approval' },
      { from: 'validating', action: 'checks-fail', to: 'draft' },
    ]);
  });

  it('terminal 推导(含内部边):rejected/deprecated;validating 不是 terminal', () => {
    expect(terminalNodes(DEFINITION_LIFECYCLE_FLOW, LIFECYCLE_INTERNAL_EDGES)).toEqual([
      'rejected',
      'deprecated',
    ]);
  });
});
