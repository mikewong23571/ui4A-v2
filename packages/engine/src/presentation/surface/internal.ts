/**
 * Surface 内核共享的私有构件:形状谓词、issue 收集、诊断节点、绑定路径与
 * 规范化(依赖/绑定排序)助手。不经 index 导出——公开面保持与拆分前一致。
 */
import type {
  SurfaceBinding,
  SurfaceDependency,
  SurfaceDiagnosticNode,
  SurfaceIssueCode,
  SurfaceValidationIssue,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

export function issue(
  issues: SurfaceValidationIssue[],
  code: SurfaceIssueCode,
  nodeId: string,
  path: string,
  message: string,
): void {
  issues.push({ code, nodeId, path, message });
}

export function diagnosticNode(
  path: string,
  code: string,
  failedNodeId?: string,
): SurfaceDiagnosticNode {
  return {
    kind: 'diagnostic',
    id: `diagnostic:${path}`,
    role: 'diagnostic',
    code,
    ...(failedNodeId === undefined ? {} : { failedNodeId }),
    dependencies: [],
    provenance: [{ kind: 'validator', ref: code }],
  };
}

export function bindingPath(binding: Exclude<SurfaceBinding, { kind: 'item' }>): string {
  return binding.kind === 'property' ? binding.path : `$${binding.kind}`;
}

export function hasEntityDependency(
  dependencies: readonly SurfaceDependency[],
  binding: Exclude<SurfaceBinding, { kind: 'item' }>,
): boolean {
  const requiredPath = bindingPath(binding);
  return dependencies.some(
    (dependency) =>
      dependency.kind === 'entity' &&
      dependency.subject === binding.subject &&
      dependency.paths?.includes(requiredPath) === true,
  );
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function normalizedDependencies(
  dependencies: readonly SurfaceDependency[],
): SurfaceDependency[] {
  return [...dependencies]
    .map((dependency) => ({
      kind: dependency.kind,
      subject: dependency.subject,
      version: dependency.version,
      ...(dependency.paths === undefined ? {} : { paths: [...new Set(dependency.paths)].sort() }),
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

export function normalizedBindings(
  bindings: Readonly<Record<string, SurfaceBinding>>,
): Record<string, SurfaceBinding> {
  return Object.fromEntries(
    Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right)),
  );
}
