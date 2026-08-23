/**
 * capability seed 常量测试(T13 Phase C Task 2;spec 架构决定 3):
 * - seed(draft/summarize/notify/clarify)均过 parseCapabilityDefinition 校验
 *   (name/title/kind/intent 必填,kind ∈ transform/extract/effect),
 *   声明序 = boot 入日志序;
 * - seed 名集覆盖业务 flow 定义里的全部 capability 引用点——field source
 *   proposal.capability、effect spawn.capability、on-invalid 澄清标记;
 *   这是 capability-registered(Phase D)的静态保证(seed 缺口会让合法
 *   flow 提交被误拒,与 applications 的 app-known 静态保证同构)。
 */
import { describe, expect, it } from 'vitest';

import { parseCapabilityDefinition } from '@ui4a/engine';
import type { FlowDefinition } from '@ui4a/engine';

import {
  businessCapabilityList,
  clarifyCapability,
  draftCapability,
  notifyCapability,
} from './capabilities';
import { businessFlowList } from './flows';

/**
 * 业务 flow 定义里的全部 capability 引用名(引用盘点,Phase D 不变式的
 * 同一扫描面):proposal 字段来源 / spawn 效果 / on-invalid 澄清标记。
 */
function referencedCapabilities(flow: FlowDefinition): string[] {
  const referenced: string[] = [];
  const visitFields = (fields: FlowDefinition['fields']): void => {
    for (const field of fields ?? []) {
      if (field.source?.kind === 'proposal' && field.source.capability !== undefined) {
        referenced.push(field.source.capability);
      }
      if (field['on-invalid'] !== undefined) {
        referenced.push(field['on-invalid']);
      }
    }
  };
  visitFields(flow.fields);
  for (const node of flow.nodes) {
    visitFields(node.fields);
    for (const action of node.actions) {
      visitFields(action.fields);
      const effects = Array.isArray(action.effect)
        ? action.effect
        : action.effect !== undefined
          ? [action.effect]
          : [];
      for (const effect of effects) {
        if (effect.type === 'spawn') {
          referenced.push(effect.capability);
        }
      }
    }
  }
  return referenced;
}

describe('capability seed 常量(T13)', () => {
  it('draft/notify/clarify 均通过 parseCapabilityDefinition 校验且 intent 在场', () => {
    for (const capability of businessCapabilityList) {
      expect(() => parseCapabilityDefinition(capability)).not.toThrow();
      expect(capability.title.length).toBeGreaterThan(0);
      expect(capability.intent.length).toBeGreaterThan(0);
    }
    expect(businessCapabilityList.map((capability) => capability.name)).toEqual([
      'draft',
      'notify',
      'clarify',
    ]);
    expect(businessCapabilityList.some((capability) => capability.name === 'summarize')).toBe(
      false,
    );
  });

  it('两类 kind 覆盖引用语义:draft/clarify=extract(模型背书提取),notify=effect(效应)', () => {
    expect(draftCapability.kind).toBe('extract');
    expect(notifyCapability.kind).toBe('effect');
    expect(clarifyCapability.kind).toBe('extract');
  });

  it('seed 名集覆盖业务 flow 定义的全部 capability 引用(静态保证)', () => {
    const seeded = new Set(businessCapabilityList.map((capability) => capability.name));
    const referenced = businessFlowList.flatMap((flow) => referencedCapabilities(flow));
    // 防空转锚:当前业务定义确实引用 draft(article-drafting 的 body 字段);
    // 引用集为空时本测试退化为恒真,先钉住再比对。
    expect(referenced).toContain('draft');
    for (const name of referenced) {
      expect(seeded.has(name), `被引用的 capability "${name}" 应由 boot seed 注册`).toBe(true);
    }
  });
});
