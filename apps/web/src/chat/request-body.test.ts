import { describe, expect, it } from 'vitest';

import { parseBody } from './request-body';

// crypto.randomUUID() 的 UUID v4 形状(代铸缺省值的合同)。
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { goal: { verb: 'open' }, ...overrides };
}

// 'a1._:-' × 21 + 首尾字母数字 = 128 字符,恰好覆盖长度上界与全部允许标点。
const BOUNDARY_128 = `s${'a1._:-'.repeat(21)}z`;

describe('T49 FR1 chat request-body sessionId 合同', () => {
  it('缺省时服务端代铸 UUID v4', () => {
    const result = parseBody(validBody());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.sessionId).toMatch(UUID_V4);
    expect(result.turnId).toMatch(UUID_V4);
  });

  it.each([
    ['crypto.randomUUID() 产物', crypto.randomUUID()],
    ['e2e fixture', 'i1-e2e'],
    ['本地 demo fixture', 'local-demo'],
    ['伪造 principal fixture', 'forged-root'],
    ['单字符下界', 'a'],
    ['128 字符上界(含 . _ : - 全集)', BOUNDARY_128],
  ])('接受合法 sessionId:%s', (_label, sessionId) => {
    const result = parseBody(validBody({ sessionId }));
    expect(result).toMatchObject({ ok: true, sessionId });
  });

  it.each([
    ['空串', ''],
    ['首字符为 -', '-bad'],
    ['首字符为 .', '.bad'],
    ['首字符为 :', ':bad'],
    ['129 字符超长', 'a'.repeat(129)],
    ['含空格', 'local demo'],
    ['含中文', '会话-1'],
    ['含斜杠', 'app/session'],
  ])('拒绝非法 sessionId:%s', (_label, sessionId) => {
    const result = parseBody(validBody({ sessionId }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('sessionId');
  });

  it('sessionId 非字符串时仍以类型错误拒绝', () => {
    const result = parseBody(validBody({ sessionId: 42 }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('sessionId') });
  });

  it.each([
    ['goal 非对象', { goal: 'open' }, 'goal'],
    ['driver 非法', { driver: 'random' }, 'driver'],
    ['mode 非法', { mode: 'other' }, 'mode'],
  ])('既有字段校验不回归:%s', (_label, overrides, keyword) => {
    const result = parseBody(validBody(overrides));
    expect(result).toEqual({ ok: false, error: expect.stringContaining(keyword) });
  });
});
