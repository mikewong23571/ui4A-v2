import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('current documentation governance', () => {
  it('keeps current entry points AI-first and free of obsolete provider/fallback instructions', () => {
    const current = [
      'README.md',
      'AGENTS.md',
      'GOAL.md',
      'conductor/demo-checklist.md',
      'conductor/product.md',
    ].map(read);
    for (const source of current) {
      expect(source).not.toContain('**AI-optional:**');
      expect(source).not.toMatch(/无 key 时自动回退 rule driver/i);
      expect(source).not.toContain('GLM_API_KEY');
    }
  });

  it('declares document authority, external App authoring, and current audit entry points', () => {
    expect(read('README.md')).toMatch(/文档权威顺序/);
    expect(read('README.md')).toContain('docs/audit-and-replay.md');
    expect(read('GOAL.md')).toMatch(/外置 Agent/);
    expect(read('DECISIONS.md')).toMatch(/D28 摘要保持 Assistant 原生认知/);
  });

  it('labels the original architecture and selection documents as historical', () => {
    for (const path of [
      'docs/UI4A-v2（重排版）：界面作为合同，应用作为数据，能力作为边界.md',
      'docs/UI4A-技术选型.md',
    ]) {
      expect(read(path).slice(0, 1_500)).toMatch(/历史/);
    }
  });
});
