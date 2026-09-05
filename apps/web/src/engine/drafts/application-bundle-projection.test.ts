/**
 * G04b(T54 证据时点):application-bundle Draft 投影的 checks 按当前事实求值;
 * 应用安装后 `application-not-installed` 为 false 是**批准后当前事实**,不是
 * 批准失败——投影附时点明细,不给历史补造 PASS,不靠 UI 特判业务名。
 */
import { describe, expect, it } from 'vitest';

import type { ApplicationDefinition } from '@ui4a/shared';

import { projectApplicationBundleDraft } from './application-bundle';

const app = (name: string): ApplicationDefinition => ({
  name,
  title: name,
  intent: 'fixture',
});

const PAYLOAD = {
  bundle: { name: 'demo-bundle', title: 'Demo', intent: 'fixture' },
  applications: [app('demo-bundle')],
  capabilities: [],
  flows: [],
};

describe('projectApplicationBundleDraft 证据时点(G04b)', () => {
  it('未安装:application-not-installed 通过且无时点明细(批准前事实)', () => {
    const projected = projectApplicationBundleDraft(
      { applications: { publishing: app('publishing') } } as never,
      'demo-bundle',
      PAYLOAD,
    );
    const check = projected.checks.find(({ name }) => name === 'application-not-installed');
    expect(check).toEqual({ name: 'application-not-installed', pass: true });
  });

  it('已安装(批准后):check 按当前事实为 false,附「非批准失败」时点明细', () => {
    const projected = projectApplicationBundleDraft(
      { applications: { publishing: app('publishing'), 'demo-bundle': app('demo-bundle') } } as never,
      'demo-bundle',
      PAYLOAD,
    );
    const check = projected.checks.find(({ name }) => name === 'application-not-installed');
    expect(check).toMatchObject({ pass: false });
    expect(check?.detail?.join(' ')).toContain('当前事实');
    expect(check?.detail?.join(' ')).toContain('不是批准失败');
  });
});
