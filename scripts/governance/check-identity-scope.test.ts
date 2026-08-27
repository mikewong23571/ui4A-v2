// GR6 check-identity-scope 的夹具测试:注入虚拟文件树与例外登记表,
// 不依赖真实仓库状态(真实调用点由 pnpm governance 直接扫描)。
import { describe, expect, it } from 'vitest';

import { checkIdentityScope, findIdentityCallSites, maskNoise } from './check-identity-scope.mjs';

const OK_ROUTE = `import { resolveTrustedRequestIdentity } from '../../../auth/request-identity';

export async function POST(request: Request) {
  const identity = await resolveTrustedRequestIdentity(request, {
    plane: 'business',
    requiredScopes: ['ui4a:read'],
    defaultPolicyScope: 'development',
    // 按目标 rel 在 granted scope 中选择。
    scopeCoverage: (policyScope) =>
      relCoveredByPolicyScope({ snapshot, sitemap, plane: 'business' }, rel, policyScope),
  });
  return Response.json({ scope: identity.policyScope });
}
`;

const BAD_ROUTE = `import { resolveTrustedRequestIdentity } from '../../../auth/request-identity';

export async function POST(request: Request) {
  // 缺 scopeCoverage:policyScope 被冻结为 defaultPolicyScope 字面量。
  const identity = await resolveTrustedRequestIdentity(
    request,
    {
      plane: 'business',
      requiredScopes: ['ui4a:read'],
      defaultPolicyScope: 'default',
      // 注释里提到 scopeCoverage 字样不算数。
    },
  );
  return Response.json({ scope: identity.policyScope });
}
`;

const TWO_CALLS_ROUTE = `export async function POST(request: Request) {
  const first = await resolveTrustedRequestIdentity(request, {
    defaultPolicyScope: scopes[0]!,
    scopeCoverage: (scope) => covers(scope, rel),
  });
  const second = await resolveTrustedRequestIdentity(other, {
    defaultPolicyScope: first.policyScope,
  });
  return Response.json({ note: 'scopeCoverage in a string is not a closure' });
}
`;

function harness(sourceByFile, exceptions = []) {
  return checkIdentityScope({
    files: Object.keys(sourceByFile),
    readFile: (f) => sourceByFile[f],
    exceptions,
  });
}

describe('maskNoise', () => {
  it('blanks strings and comments while preserving newlines', () => {
    const masked = maskNoise('const a = "x // y";\n// line\n/* b */ const c = 1;');
    expect(masked).not.toContain('x // y');
    expect(masked.split('\n')).toHaveLength(3);
    expect(masked).toContain('const c = 1;');
  });
});

describe('findIdentityCallSites', () => {
  it('detects scopeCoverage inside a multi-line options object', () => {
    const sites = findIdentityCallSites(OK_ROUTE);
    expect(sites).toHaveLength(1);
    expect(sites[0].hasScopeCoverage).toBe(true);
    expect(sites[0].line).toBe(4);
  });

  it('ignores scopeCoverage mentioned only in comments or strings', () => {
    const sites = findIdentityCallSites(BAD_ROUTE);
    expect(sites).toHaveLength(1);
    expect(sites[0].hasScopeCoverage).toBe(false);
  });

  it('reports each call site independently', () => {
    const sites = findIdentityCallSites(TWO_CALLS_ROUTE);
    expect(sites.map((s) => s.hasScopeCoverage)).toEqual([true, false]);
    expect(sites[1].line).toBe(6);
  });
});

describe('checkIdentityScope', () => {
  it('passes when every call site carries scopeCoverage', () => {
    const { violations, staleExceptions } = harness({ 'app/a/route.ts': OK_ROUTE });
    expect(violations).toEqual([]);
    expect(staleExceptions).toEqual([]);
  });

  it('fails an unregistered call site missing scopeCoverage', () => {
    const { violations } = harness({ 'app/b/route.ts': BAD_ROUTE });
    expect(violations).toEqual([{ file: 'app/b/route.ts', lines: [5] }]);
  });

  it('flags only the offending call site in a multi-call file', () => {
    const { violations } = harness({ 'app/c/route.ts': TWO_CALLS_ROUTE });
    expect(violations).toEqual([{ file: 'app/c/route.ts', lines: [6] }]);
  });

  it('accepts a registered exception with reason and retireWhen', () => {
    const exceptions = [
      { path: 'app/b/route.ts', reason: '无单一目标 rel', retireWhen: '引入目标 rel 时移除' },
    ];
    const { violations, usedExceptions, staleExceptions } = harness(
      { 'app/b/route.ts': BAD_ROUTE },
      exceptions,
    );
    expect(violations).toEqual([]);
    expect(usedExceptions).toHaveLength(1);
    expect(staleExceptions).toEqual([]);
  });

  it('fails a registered entry missing reason or retireWhen', () => {
    const exceptions = [{ path: 'app/b/route.ts', reason: '只有理由没有退役条件' }];
    const { violations, malformed } = harness({ 'app/b/route.ts': BAD_ROUTE }, exceptions);
    expect(malformed).toHaveLength(1);
    expect(violations).toEqual([{ file: 'app/b/route.ts', lines: [5] }]);
  });

  it('fails a stale entry whose file no longer offends (shrink-only registry)', () => {
    const exceptions = [
      { path: 'app/a/route.ts', reason: '历史例外', retireWhen: '已具备 scopeCoverage' },
    ];
    const { violations, staleExceptions } = harness({ 'app/a/route.ts': OK_ROUTE }, exceptions);
    expect(violations).toEqual([]);
    expect(staleExceptions).toHaveLength(1);
  });
});
