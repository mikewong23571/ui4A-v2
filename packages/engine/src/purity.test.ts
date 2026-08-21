/**
 * 引擎两栖性守卫(DoD:@ui4a/engine 库源不依赖任何 Node 专属 API)。
 *
 * 扫描 src 下全部非测试 .ts 源文件,断言:
 * - 不 import Node 内置模块(node: 前缀或裸名 fs/path/os/crypto/…);
 * - 不引用 process/Buffer 全局。
 * 本文件自身是唯一允许使用 node:fs 的地方(测试代码,不进库源;
 * tsconfig 的 types:["node"] 只服务测试的类型解析,两栖性由本测试文本级强制)。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as engine from './index';

const srcDir = dirname(fileURLToPath(import.meta.url));

function librarySources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => join(directory, entry.name));
}

const NODE_MODULE_PATTERN =
  /from\s+['"](node:)?(fs|path|os|http|https|crypto|stream|child_process|util|url|buffer|events|worker_threads|net|tls|zlib|querystring|readline)['"]/;
const NODE_GLOBAL_PATTERN = /\bprocess\.[A-Za-z_]|\bBuffer\b/;

describe('引擎两栖性(纯 TS,浏览器/服务端零 Node API)', () => {
  it('库源文件不 import Node 内置模块', () => {
    for (const file of librarySources(srcDir)) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} 引用了 Node 内置模块`).not.toMatch(NODE_MODULE_PATTERN);
    }
  });

  it('库源文件不引用 process/Buffer 全局', () => {
    for (const file of librarySources(srcDir)) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} 引用了 Node 全局`).not.toMatch(NODE_GLOBAL_PATTERN);
    }
  });

  it('扫描到的库源覆盖引擎全部模块(17 个非测试源文件;T4 增 lifecycle/meta/invariants/definition-diff)', () => {
    expect(librarySources(srcDir).length).toBe(17);
  });

  it('公共导出面完整(barrel 可整体导入求值)', () => {
    const exports = Object.keys(engine);
    expect(exports).toEqual(
      expect.arrayContaining([
        'parseFlowDefinition',
        'validateFlowDefinition',
        'createFlowMachine',
        'canTransition',
        'canSendEvent',
        'fieldDefinitionsToJsonSchema',
        'judge',
        'evaluateGuards',
        'applyEffects',
        'slugify',
        'fold',
        'project',
        'deriveSitemap',
        'canonicalJson',
        'contentVersion',
        'confirmGate',
        'builtinConfirmationPolicy',
        'executeWithGates',
        'definitionDiff',
      ]),
    );
  });
});
