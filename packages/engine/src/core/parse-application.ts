import {
  APPLICATION_ENTRY_ROLES,
  parseCognitiveSemanticsDeclaration,
  type ApplicationDefinition,
  type ApplicationEntry,
  type CognitiveSemanticsDeclarationV1,
  type SubmissionPolicy,
} from '@ui4a/shared';

import type { FlowIssue } from './parse';

const APPLICATION_KEYS = new Set(['name', 'title', 'intent', 'entry', 'submission', 'cognitive']);
const ENTRY_KEYS = new Set(['target', 'role']);
const APPLICATION_COGNITIVE_KEYS = new Set(['version', 'traits']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** application 定义解析失败：携带可定位到嵌套字段的全部 issues。 */
export class AppParseError extends Error {
  readonly issues: FlowIssue[];

  constructor(issues: FlowIssue[]) {
    super(
      `非法 application 定义:\n${issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n')}`,
    );
    this.name = 'AppParseError';
    this.issues = issues;
  }
}

function parseEntry(value: unknown, issues: FlowIssue[]): ApplicationEntry | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) {
    issues.push({ path: 'entry', message: 'entry 必须是 {target,role} 对象' });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.has(key)) {
      issues.push({ path: `entry.${key}`, message: `entry 不允许字段 "${key}"` });
    }
  }
  const target = value.target;
  if (
    typeof target !== 'string' ||
    target === '' ||
    target.includes('/') ||
    /^(?:_?meta(?::|$)|workspace:|https?:)/.test(target)
  ) {
    issues.push({
      path: 'entry.target',
      message: 'entry.target 必须是业务 flow、collection 或 entity rel',
    });
  }
  const role = value.role;
  if (typeof role !== 'string' || !APPLICATION_ENTRY_ROLES.includes(role as never)) {
    issues.push({ path: 'entry.role', message: 'entry.role 不在闭集词汇中' });
  }
  return typeof target === 'string' &&
    target !== '' &&
    typeof role === 'string' &&
    APPLICATION_ENTRY_ROLES.includes(role as never)
    ? { target, role: role as ApplicationEntry['role'] }
    : undefined;
}

function parseSubmission(value: unknown, issues: FlowIssue[]): SubmissionPolicy | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || !['draft', 'direct', 'none'].includes(String(value.mode))) {
    issues.push({ path: 'submission', message: 'submission.mode 必须是 draft/direct/none' });
    return undefined;
  }
  for (const key of ['actors', 'scopes'] as const) {
    const rows = value[key];
    if (
      rows !== undefined &&
      (!Array.isArray(rows) || rows.some((row) => typeof row !== 'string'))
    ) {
      issues.push({ path: `submission.${key}`, message: `${key} 必须是字符串数组` });
    }
  }
  return value as unknown as SubmissionPolicy;
}

function parseApplicationCognitive(
  value: unknown,
  issues: FlowIssue[],
): CognitiveSemanticsDeclarationV1 | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) {
    issues.push({ path: 'cognitive', message: 'cognitive 必须是对象' });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!APPLICATION_COGNITIVE_KEYS.has(key)) {
      issues.push({
        path: `cognitive.${key}`,
        message: `Application cognitive 不允许字段 "${key}"`,
      });
    }
  }
  if (value.version !== 1) {
    issues.push({ path: 'cognitive.version', message: 'cognitive.version 必须是 1' });
  }
  if (value.traits !== undefined) {
    if (!Array.isArray(value.traits) || value.traits.length !== 1) {
      issues.push({
        path: 'cognitive.traits',
        message: 'Application 只允许单一 system-fallback trait',
      });
    } else if (value.traits[0] !== 'system-fallback') {
      issues.push({
        path: 'cognitive.traits[0]',
        message: 'Application 只允许 system-fallback trait',
      });
    }
  }
  try {
    return parseCognitiveSemanticsDeclaration(value);
  } catch (error) {
    if (issues.length === 0) {
      issues.push({
        path: 'cognitive',
        message: error instanceof Error ? error.message : 'cognitive 声明非法',
      });
    }
    return undefined;
  }
}

/** Strict unknown -> ApplicationDefinition parser. */
export function parseApplicationDefinition(input: unknown): ApplicationDefinition {
  if (!record(input)) {
    throw new AppParseError([{ path: '(root)', message: 'application 定义必须是对象' }]);
  }
  const issues: FlowIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!APPLICATION_KEYS.has(key)) {
      issues.push({ path: key, message: `application 不允许字段 "${key}"` });
    }
  }
  for (const key of ['name', 'title', 'intent'] as const) {
    if (typeof input[key] !== 'string' || input[key] === '') {
      issues.push({ path: key, message: `${key} 必须是非空字符串` });
    }
  }
  const entry = parseEntry(input.entry, issues);
  const submission = parseSubmission(input.submission, issues);
  const cognitive = parseApplicationCognitive(input.cognitive, issues);
  if (entry !== undefined && cognitive?.traits?.includes('system-fallback')) {
    issues.push({ path: 'entry', message: 'system-fallback Application 不得声明 entry' });
  }
  if (issues.length > 0) throw new AppParseError(issues);
  return {
    name: input.name as string,
    title: input.title as string,
    intent: input.intent as string,
    ...(entry === undefined ? {} : { entry }),
    ...(submission === undefined ? {} : { submission }),
    ...(cognitive === undefined ? {} : { cognitive }),
  };
}
