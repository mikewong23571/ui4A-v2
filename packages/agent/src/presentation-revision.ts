/** Independent LLM adapter for natural-language Presentation revisions. */
import {
  normalizeRevisionRenderPatch,
  parseRevisionRequest,
  type RenderPatch,
  type RevisionRequest,
  type SurfaceCatalog,
  type SurfaceTree,
} from '@ui4a/engine';
import { streamText } from 'ai';

import { createLlmChatModel, type LlmDriverOptions } from './llm-driver';
import { LlmConfigurationError, resolveLlmConfig } from './llm-config';

export interface PresentationRevisionInput {
  request: RevisionRequest;
  surface: SurfaceTree;
  catalog: SurfaceCatalog;
}

export type PresentationRevisionResult =
  | { status: 'patch'; patch: RenderPatch }
  | {
      status: 'failed';
      reasonCode: 'configuration-unavailable' | 'transport-failed' | 'output-invalid';
      issues: string[];
    };

export interface PresentationRevisionAgent {
  revise(input: PresentationRevisionInput): Promise<PresentationRevisionResult>;
}

export interface PresentationRevisionAgentOptions extends LlmDriverOptions {
  timeoutMs?: number;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const candidate = fenced?.[1] ?? (start >= 0 && end >= start ? text.slice(start, end + 1) : '');
  if (candidate.length === 0 || candidate.length > 64_000) return undefined;
  return JSON.parse(candidate);
}

/** The model receives binding-only structure and catalog compatibility, never live fact values. */
export function buildPresentationRevisionPrompt(input: PresentationRevisionInput): string {
  const request = parseRevisionRequest(input.request);
  return [
    'Translate the human instruction into semantic Render Patch operations.',
    'Return only JSON: {"operations":[...]}. Never return CSS, code, facts, bindings or a Surface.',
    'Allowed exact operation shapes (no extra fields):',
    '- {"kind":"collapse","nodeId":"<existing-node-id>","collapsed":true|false}',
    '- {"kind":"density","nodeId":"<existing-node-id>","density":"compact|comfortable|spacious"}',
    '- {"kind":"move","nodeId":"<existing-node-id>","toParentId":"<layout-id>","toIndex":0}',
    '- {"kind":"compatible-word","nodeId":"<word-node-id>","word":"<catalog-word>"}',
    '- {"kind":"pin","retention":"cache|pinned"}',
    'Use density spacious to emphasize content and collapse true to hide a region.',
    JSON.stringify({
      instruction: request.instruction,
      surface: input.surface,
      catalog: {
        id: input.catalog.id,
        version: input.catalog.version,
        words: Object.keys(input.catalog.words).sort(),
      },
    }),
  ].join('\n');
}

export function parsePresentationRevision(
  text: string,
  request: RevisionRequest,
): PresentationRevisionResult {
  try {
    const parsed = extractJson(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== 'operations') throw new Error();
    const patch = normalizeRevisionRenderPatch(
      request,
      (parsed as { operations?: unknown }).operations,
    );
    return { status: 'patch', patch };
  } catch {
    return {
      status: 'failed',
      reasonCode: 'output-invalid',
      issues: ['Presentation revision output is invalid'],
    };
  }
}

export function createPresentationRevisionAgent(
  options: PresentationRevisionAgentOptions = {},
): PresentationRevisionAgent {
  return {
    async revise(input) {
      try {
        resolveLlmConfig(options);
      } catch (error) {
        return {
          status: 'failed',
          reasonCode: 'configuration-unavailable',
          issues: [
            error instanceof LlmConfigurationError
              ? error.message
              : 'LLM profile could not be resolved',
          ],
        };
      }
      try {
        const result = streamText({
          model: createLlmChatModel(options),
          system:
            'You are an independent UI4A Presentation Revision Agent. Return semantic operations only.',
          prompt: buildPresentationRevisionPrompt(input),
          abortSignal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
          maxRetries: 0,
        });
        let text = '';
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') text += part.text;
          else if (part.type === 'error') throw part.error;
          else if (part.type === 'abort') throw new Error(part.reason ?? 'revision aborted');
        }
        return parsePresentationRevision(text, input.request);
      } catch {
        return {
          status: 'failed',
          reasonCode: 'transport-failed',
          issues: ['Presentation revision LLM request failed'],
        };
      }
    },
  };
}
