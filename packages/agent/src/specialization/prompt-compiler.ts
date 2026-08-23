import { canonicalAgentJson, hashCanonicalAgentJson } from '@ui4a/engine';

/** Provider-neutral roles supported by the specialization contract. */
export type PromptMessageRole = 'system' | 'user' | 'assistant';
/** Semantic purpose retained across Provider adapter translations. */
export type PromptBlockPurpose =
  'authority' | 'instruction' | 'task-data' | 'context-data' | 'policy-data';

/** Whole-value dynamic binding declared by an activated Prompt Template. */
export interface PromptCompilerBinding {
  source: 'task' | 'context' | 'policy';
  pointer: string;
  encoding: 'json-delimited';
  required: boolean;
}

/** Structural Prompt block consumed from a flattened Agent Definition. */
export interface PromptCompilerBlock {
  id: string;
  role: PromptMessageRole;
  purpose: PromptBlockPurpose;
  sealed?: boolean;
  literal?: string;
  binding?: PromptCompilerBinding;
}

/** Minimal structural view accepted from a flattened Agent Definition. */
export interface PromptCompilerDefinition {
  ref: string;
  prompt: {
    schemaVersion: number;
    blocks: PromptCompilerBlock[];
  };
}

/** One stable provider-neutral message block produced by the Prompt compiler. */
export interface CompiledPromptMessage {
  blockId: string;
  role: PromptMessageRole;
  purpose: PromptBlockPurpose;
  content: string;
  sealed: boolean;
}

/** Canonical output and provenance anchors for one Prompt compilation. */
export interface CompiledSpecializedPrompt {
  definitionRef: string;
  definitionHash: `sha256:${string}`;
  templateHash: `sha256:${string}`;
  messages: CompiledPromptMessage[];
  compiledHash: `sha256:${string}`;
  omittedOptionalBlockIds: string[];
}

/** Minimal provider-neutral shape that an adapter can actually send. */
export interface SentPromptMessage {
  role: PromptMessageRole;
  content: string;
}

/** Immutable evidence for the exact provider-neutral messages handed to an adapter. */
export interface PromptDispatchProvenance {
  definitionRef: string;
  adapterRef: string;
  compiledHash: `sha256:${string}`;
  sentMessagesHash: `sha256:${string}`;
  sentMessageCount: number;
}

interface ResolvedPointer {
  found: boolean;
  value?: unknown;
}

function hashJson(value: unknown): `sha256:${string}` {
  return hashCanonicalAgentJson(value as Parameters<typeof hashCanonicalAgentJson>[0]);
}

function decodePointerToken(token: string, pointer: string): string {
  if (/~(?:[^01]|$)/.test(token)) throw new Error(`Prompt binding pointer ${pointer} is invalid`);
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveJsonPointer(root: unknown, pointer: string): ResolvedPointer {
  if (pointer === '') return { found: root !== undefined, value: root };
  if (!pointer.startsWith('/')) throw new Error(`Prompt binding pointer ${pointer} is invalid`);
  let current = root;
  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = decodePointerToken(encodedToken, pointer);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false };
      const index = Number(token);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== 'object') return { found: false };
    if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false };
    current = (current as Record<string, unknown>)[token];
  }
  return { found: current !== undefined, value: current };
}

function assertBindingBoundary(block: PromptCompilerBlock, binding: PromptCompilerBinding): void {
  if (
    (binding.source === 'task' || binding.source === 'context') &&
    (block.role === 'system' || block.purpose === 'authority')
  ) {
    throw new Error('task/context bindings cannot create system or authority blocks');
  }
  const expectedPurpose = `${binding.source}-data`;
  const validPolicyPurpose =
    binding.source === 'policy' &&
    (block.purpose === 'policy-data' || block.purpose === 'authority');
  if (block.purpose !== expectedPurpose && !validPolicyPurpose) {
    throw new Error(
      `Prompt binding ${block.id} source ${binding.source} requires purpose ${expectedPurpose}`,
    );
  }
  if (binding.source !== 'policy' && block.role !== 'user') {
    throw new Error(`Prompt binding ${block.id} must use the user role`);
  }
  if (block.sealed === true && binding.source !== 'policy') {
    throw new Error(`Prompt binding ${block.id} cannot seal task or context data`);
  }
  if (block.purpose === 'authority' && (block.role !== 'system' || block.sealed !== true)) {
    throw new Error(`Prompt authority block ${block.id} must be sealed and use the system role`);
  }
}

function assertLiteralBoundary(block: PromptCompilerBlock): void {
  if (block.purpose === 'authority' && (block.role !== 'system' || block.sealed !== true)) {
    throw new Error(`Prompt authority block ${block.id} must be sealed and use the system role`);
  }
  if (/\{\{[^}]+\}\}|\$\{[^}]+\}/.test(block.literal!)) {
    throw new Error(`Prompt literal ${block.id} must not contain template interpolation`);
  }
}

function encodeBoundValue(blockId: string, binding: PromptCompilerBinding, value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error(`Prompt binding ${blockId} did not resolve to JSON`);
  const canonical = canonicalAgentJson(
    JSON.parse(json) as Parameters<typeof canonicalAgentJson>[0],
  );
  const byteLength = new TextEncoder().encode(canonical).byteLength;
  return [
    `<<<UI4A_DATA_JSON_V1 block=${JSON.stringify(blockId)} source=${binding.source} pointer=${JSON.stringify(binding.pointer)} bytes=${byteLength}>>>`,
    canonical,
    '<<<END_UI4A_DATA_JSON_V1>>>',
  ].join('\n');
}

/**
 * Compile a flattened specialization Prompt without interpolation.
 *
 * Bound values occupy whole length-described JSON blocks. Task and context data can never become
 * system authority; only the activated definition and its server-owned policy snapshot can do so.
 */
export function compileSpecializedPrompt(input: {
  definition: PromptCompilerDefinition;
  task: unknown;
  context: unknown;
  policy: unknown;
}): CompiledSpecializedPrompt {
  const messages: CompiledPromptMessage[] = [];
  const omittedOptionalBlockIds: string[] = [];
  const sources = { task: input.task, context: input.context, policy: input.policy } as const;

  for (const block of input.definition.prompt.blocks) {
    const hasLiteral = block.literal !== undefined;
    const hasBinding = block.binding !== undefined;
    if (hasLiteral === hasBinding) {
      throw new Error(`Prompt block ${block.id} must contain exactly one literal or binding`);
    }
    if (hasLiteral) {
      assertLiteralBoundary(block);
      messages.push({
        blockId: block.id,
        role: block.role,
        purpose: block.purpose,
        content: block.literal!,
        sealed: block.sealed === true,
      });
      continue;
    }

    const binding = block.binding!;
    assertBindingBoundary(block, binding);
    const resolved = resolveJsonPointer(sources[binding.source], binding.pointer);
    if (!resolved.found) {
      if (binding.required) throw new Error(`required Prompt binding ${block.id} is missing`);
      omittedOptionalBlockIds.push(block.id);
      continue;
    }
    messages.push({
      blockId: block.id,
      role: block.role,
      purpose: block.purpose,
      content: encodeBoundValue(block.id, binding, resolved.value),
      sealed: block.sealed === true,
    });
  }

  return {
    definitionRef: input.definition.ref,
    definitionHash: hashJson(input.definition),
    templateHash: hashJson(input.definition.prompt),
    messages,
    compiledHash: hashJson(messages),
    omittedOptionalBlockIds,
  };
}

/** Record the exact message sequence an adapter received, without trusting a declared hash. */
export function recordPromptDispatch(input: {
  compiled: CompiledSpecializedPrompt;
  adapterRef: string;
  sentMessages: readonly SentPromptMessage[];
}): PromptDispatchProvenance {
  const sentMessages = input.sentMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  return {
    definitionRef: input.compiled.definitionRef,
    adapterRef: input.adapterRef,
    compiledHash: input.compiled.compiledHash,
    sentMessagesHash: hashJson(sentMessages),
    sentMessageCount: sentMessages.length,
  };
}
