/**
 * Bare Surface template 的结构解析与限额(从 presentation-agent.ts 拆出,行为不变)。
 * 模型输出是不可信的 bare 模板:只允许结构节点与 binding 引用,
 * 任何字面事实字段都在此被拒绝。
 */
import { SEMANTIC_REGION_ROLES, type SemanticRegionRole, type SurfaceBinding } from '@ui4a/engine';

import type { PresentationGenerationInput } from './presentation-types';

export const MAX_DEFINITIONS = 32;
export const MAX_SLOTS = 16;
export const MAX_WORDS = 64;
export const MAX_BINDINGS_PER_WORD = 32;
export const MAX_EXAMPLES = 3;
export const MAX_EXAMPLE_BYTES = 12_000;
export const MAX_OUTPUT_BYTES = 64_000;
export const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
export const STRUCTURAL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const STRUCTURAL_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/#-]{0,255}$/;
export const SLOT_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export const STRUCTURAL_PATH = /^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z0-9_$-]+)*$/;
export const FORBIDDEN_IDENTITY = /(?:^|[._:/-])(principal|session(?:id)?)(?:$|[._:/-])/i;
export const ROLE_SET = new Set<string>(SEMANTIC_REGION_ROLES);
export const SCENARIO_KIND_SET = new Set<string>([
  'application-overview',
  'entity-inspect',
  'current-task',
  'collection-browse',
  'confirmation-review',
  'artifact-inspect',
]);

export interface BareNodeBase {
  id: string;
  role: SemanticRegionRole;
}

export type BareSurfaceNode =
  | (BareNodeBase & {
      kind: 'layout';
      layout: 'stack' | 'grid' | 'inline';
      children: BareSurfaceNode[];
    })
  | (BareNodeBase & { kind: 'slot'; name: string; child: BareSurfaceNode })
  | (BareNodeBase & {
      kind: 'repeat';
      source: Extract<SurfaceBinding, { kind: 'entities' }>;
      item: BareSurfaceNode;
    })
  | (BareNodeBase & {
      kind: 'word';
      word: string;
      bindings: Record<string, SurfaceBinding>;
    });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function safeStructuralString(value: string): boolean {
  return STRUCTURAL_REF.test(value) && !FORBIDDEN_IDENTITY.test(value);
}

function allowedPointers(input: PresentationGenerationInput): Set<string> {
  return new Set(input.definitions.flatMap((definition) => definition.allowedPointers ?? []));
}

function parseSubject(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): string | undefined {
  if (!nonEmpty(value) || !value.startsWith('$slot:')) {
    issues.push(`${path} must use a declared $slot subject`);
    return undefined;
  }
  const slot = value.slice('$slot:'.length);
  if (!input.scenario.slots.includes(slot)) {
    issues.push(`${path} references unbound slot`);
    return undefined;
  }
  return value;
}

function parsePath(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): string | undefined {
  if (!nonEmpty(value) || !STRUCTURAL_PATH.test(value) || !allowedPointers(input).has(value)) {
    issues.push(`${path} is not an allowed structural pointer`);
    return undefined;
  }
  return value;
}

function parseBinding(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): SurfaceBinding | undefined {
  if (!isRecord(value) || !nonEmpty(value.kind)) {
    issues.push(`${path} is not a binding object`);
    return undefined;
  }
  switch (value.kind) {
    case 'property': {
      if (!exactKeys(value, ['kind', 'subject', 'path'])) {
        issues.push(`${path} contains factual or unknown fields`);
        return undefined;
      }
      const subject = parseSubject(value.subject, input, `${path}.subject`, issues);
      const bindingPath = parsePath(value.path, input, `${path}.path`, issues);
      return subject === undefined || bindingPath === undefined
        ? undefined
        : { kind: 'property', subject, path: bindingPath };
    }
    case 'actions':
    case 'links':
    case 'entities': {
      if (!exactKeys(value, ['kind', 'subject'])) {
        issues.push(`${path} contains factual or unknown fields`);
        return undefined;
      }
      const subject = parseSubject(value.subject, input, `${path}.subject`, issues);
      return subject === undefined ? undefined : { kind: value.kind, subject };
    }
    case 'item': {
      if (!exactKeys(value, ['kind', 'path'])) {
        issues.push(`${path} contains factual or unknown fields`);
        return undefined;
      }
      const bindingPath = parsePath(value.path, input, `${path}.path`, issues);
      return bindingPath === undefined ? undefined : { kind: 'item', path: bindingPath };
    }
    default:
      issues.push(`${path}.kind is unknown`);
      return undefined;
  }
}

function parseNodeBase(
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): BareNodeBase | undefined {
  if (!nonEmpty(value.id) || !IDENTIFIER.test(value.id)) issues.push(`${path}.id is invalid`);
  if (!nonEmpty(value.role) || !ROLE_SET.has(value.role)) issues.push(`${path}.role is invalid`);
  if (issues.some((issue) => issue.startsWith(`${path}.id`) || issue.startsWith(`${path}.role`))) {
    return undefined;
  }
  return { id: value.id as string, role: value.role as SemanticRegionRole };
}

export function parseBareNode(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): BareSurfaceNode | undefined {
  if (!isRecord(value) || !nonEmpty(value.kind)) {
    issues.push(`${path} is not a Surface node`);
    return undefined;
  }
  const base = parseNodeBase(value, path, issues);
  if (base === undefined) return undefined;
  switch (value.kind) {
    case 'layout': {
      if (
        !exactKeys(value, ['kind', 'id', 'role', 'layout', 'children']) ||
        !['stack', 'grid', 'inline'].includes(String(value.layout)) ||
        !Array.isArray(value.children) ||
        value.children.length === 0 ||
        value.children.length > 32
      ) {
        issues.push(`${path} layout shape is invalid or contains literal fields`);
        return undefined;
      }
      const children = value.children.map((child, index) =>
        parseBareNode(child, input, `${path}.children[${index}]`, issues),
      );
      return children.some((child) => child === undefined)
        ? undefined
        : {
            ...base,
            kind: 'layout',
            layout: value.layout as 'stack' | 'grid' | 'inline',
            children: children as BareSurfaceNode[],
          };
    }
    case 'slot': {
      if (
        !exactKeys(value, ['kind', 'id', 'role', 'name', 'child']) ||
        !nonEmpty(value.name) ||
        !STRUCTURAL_NAME.test(value.name)
      ) {
        issues.push(`${path} slot shape is invalid or contains literal fields`);
        return undefined;
      }
      const child = parseBareNode(value.child, input, `${path}.child`, issues);
      return child === undefined ? undefined : { ...base, kind: 'slot', name: value.name, child };
    }
    case 'repeat': {
      if (!exactKeys(value, ['kind', 'id', 'role', 'source', 'item'])) {
        issues.push(`${path} repeat shape is invalid or contains literal fields`);
        return undefined;
      }
      const source = parseBinding(value.source, input, `${path}.source`, issues);
      const item = parseBareNode(value.item, input, `${path}.item`, issues);
      return source?.kind !== 'entities' || item === undefined
        ? undefined
        : { ...base, kind: 'repeat', source, item };
    }
    case 'word': {
      if (
        !exactKeys(value, ['kind', 'id', 'role', 'word', 'bindings']) ||
        !nonEmpty(value.word) ||
        !isRecord(value.bindings)
      ) {
        issues.push(`${path} word shape is invalid or contains literal fields`);
        return undefined;
      }
      const word = input.catalog.words.find(({ name }) => name === value.word);
      if (word === undefined || !word.roles.includes(base.role)) {
        issues.push(`${path}.word is unknown or incompatible with its semantic role`);
        return undefined;
      }
      const bindingSpecs = new Map(word.bindings.map((binding) => [binding.name, binding]));
      const bindings: Record<string, SurfaceBinding> = {};
      for (const [name, bindingValue] of Object.entries(value.bindings)) {
        const spec = bindingSpecs.get(name);
        const binding = parseBinding(bindingValue, input, `${path}.bindings.${name}`, issues);
        if (spec === undefined || binding === undefined || !spec.sources.includes(binding.kind)) {
          issues.push(`${path}.bindings.${name} is unknown or has an incompatible source`);
          continue;
        }
        bindings[name] = binding;
      }
      for (const spec of word.bindings) {
        if (spec.required && bindings[spec.name] === undefined) {
          issues.push(`${path}.bindings.${spec.name} is required`);
        }
      }
      return issues.some((issue) => issue.startsWith(`${path}.bindings`))
        ? undefined
        : { ...base, kind: 'word', word: value.word, bindings };
    }
    default:
      issues.push(`${path}.kind is unknown`);
      return undefined;
  }
}
