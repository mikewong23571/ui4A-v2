// T55 FR1.1: GR2 marker scan must see the repository's real language — Chinese
// legacy/compat word forms (兼容/向后兼容/旧路径/遗留) alongside the English forms.
// Fixtures are injected; default behavior (repo scan) is unchanged.
import { describe, expect, it } from 'vitest';

import { checkCompat } from './check-compat.mjs';

function scan(files) {
  const readText = new Map(files.map(([file, text]) => [file, text]));
  return checkCompat({
    files: [...readText.keys()],
    readText: (file) => readText.get(file),
    allowlist: [],
  });
}

describe('GR2 compat marker scan (T55 FR1.1)', () => {
  it.each([
    ['兼容深路径入口(deploy/compose/stack-contract.json 按本路径引用)'],
    ['扁平 flows 索引保留(向后兼容),条目带 app 归属'],
    ['脚本经旧路径伸手 node_modules 而非声明依赖'],
    ['早期 receipt 缺 inventory;遗留值按缺省读出'],
  ])('detects Chinese marker form: %s', (line) => {
    const { newFindings } = scan([['fixture.ts', `// ${line}\nexport const x = 1;\n`]]);
    expect(newFindings).toEqual([{ file: 'fixture.ts', lines: [1] }]);
  });

  it('still detects the English marker forms', () => {
    const { newFindings } = scan([
      ['fixture.ts', '// legacy shim for the old wire format\nexport const x = 1;\n'],
    ]);
    expect(newFindings).toEqual([{ file: 'fixture.ts', lines: [1] }]);
  });

  it('does not flag ordinary wording without markers', () => {
    const { newFindings } = scan([
      ['fixture.ts', '// OpenAI 协议端点 + Chat Completions 传输形态\nexport const x = 1;\n'],
    ]);
    expect(newFindings).toEqual([]);
  });

  it('suppresses allowlisted files and reports stale allowlist entries', () => {
    const readText = new Map([
      ['allowed.ts', '// 兼容深路径入口\nexport const a = 1;\n'],
      ['clean.ts', '// 无标记\nexport const b = 1;\n'],
    ]);
    const result = checkCompat({
      files: [...readText.keys()],
      readText: (file) => readText.get(file),
      allowlist: [
        { path: 'allowed.ts', reason: '正当语义', pendingRemoval: false },
        { path: 'gone.ts', reason: '已不存在的登记', pendingRemoval: false },
      ],
    });
    expect(result.newFindings).toEqual([]);
    expect(result.staleEntries).toEqual([
      { path: 'gone.ts', reason: '已不存在的登记', pendingRemoval: false },
    ]);
  });
});
