/**
 * Independent Presentation Agent adapter.
 *
 * The adapter sees a bounded structural scenario, definition summaries, the live catalog summary,
 * and a few binding-only examples. It never accepts or forwards Chat history. Model output is an
 * untrusted bare Surface template; provenance and dependency metadata are added mechanically.
 *
 * 公开类型见 ./presentation-types;上下文校验与 prompt 见 ./presentation-context;
 * bare 模板结构解析见 ./presentation-template;candidate 组装见 ./presentation-candidate。
 */
import { streamText } from 'ai';

import { createLlmChatModel } from '../llm/llm-driver';
import { LlmConfigurationError, resolveLlmConfig } from '../llm/llm-config';
import { parsePresentationCandidate } from './presentation-candidate';
import { buildPresentationPrompt, contextIssues, failure } from './presentation-context';
import type {
  PresentationAgent,
  PresentationAgentOptions,
  PresentationGenerationResult,
} from './presentation-types';

export type {
  PresentationAgent,
  PresentationAgentOptions,
  PresentationCandidateProvenance,
  PresentationCatalogBindingSummary,
  PresentationCatalogSummary,
  PresentationCatalogWordSummary,
  PresentationDefinitionSummary,
  PresentationExample,
  PresentationFailureCode,
  PresentationGenerationInput,
  PresentationGenerationResult,
  PresentationScenarioDescriptor,
} from './presentation-types';
export { buildPresentationPrompt, summarizePresentationCatalog } from './presentation-context';
export { parsePresentationCandidate } from './presentation-candidate';

/** Provider-neutral, injected-transport Presentation Agent. */
export function createPresentationAgent(options: PresentationAgentOptions = {}): PresentationAgent {
  return {
    async generate(input): Promise<PresentationGenerationResult> {
      const issues = contextIssues(input);
      if (issues.length > 0) return failure('context-invalid', issues);
      let config: ReturnType<typeof resolveLlmConfig>;
      try {
        config = resolveLlmConfig(options);
      } catch (error) {
        if (error instanceof LlmConfigurationError) {
          return failure('configuration-unavailable', [error.message]);
        }
        return failure('configuration-unavailable', ['LLM profile could not be resolved']);
      }
      try {
        const result = streamText({
          model: createLlmChatModel(options),
          system:
            'You are an independent UI4A Presentation Agent. Return only the requested binding-only JSON template.',
          prompt: buildPresentationPrompt(input),
          abortSignal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
          maxRetries: 0,
        });
        let text = '';
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') text += part.text;
          else if (part.type === 'error') throw part.error;
          else if (part.type === 'abort') throw new Error(part.reason ?? 'presentation aborted');
        }
        return parsePresentationCandidate(text, input, {
          model: config.model,
          generatedAt: (options.now?.() ?? new Date()).toISOString(),
        });
      } catch {
        return failure('transport-failed', ['Presentation LLM request failed']);
      }
    },
  };
}
