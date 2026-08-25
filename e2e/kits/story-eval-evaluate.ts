import type { TestInfo } from '@playwright/test';

import {
  REPORT_SCHEMA,
  type EvalFactRef,
  type EvalTurn,
  type LlmEvalProfile,
  type StoryEvalReport,
  type StoryEvalResult,
  type StoryOutcomeEvaluation,
} from './story-eval-types';

function turnEvidence(turn: EvalTurn): string {
  return JSON.stringify({
    summary: turn.summary,
    messages: turn.messages,
    payload: turn.payload,
  });
}

function factRefsFrom(value: unknown): EvalFactRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { rel?: unknown }).rel !== 'string' ||
      typeof (entry as { pointer?: unknown }).pointer !== 'string'
    ) {
      return [];
    }
    return [
      {
        rel: (entry as { rel: string }).rel,
        pointer: (entry as { pointer: string }).pointer,
      },
    ];
  });
}

function observedFactRefs(turns: readonly EvalTurn[]): EvalFactRef[] {
  const refs = turns.flatMap((turn) => {
    const direct = factRefsFrom(turn.payload.sources);
    const steps = Array.isArray(turn.payload.steps) ? turn.payload.steps : [];
    const stepRefs = steps.flatMap((step) => {
      if (typeof step !== 'object' || step === null) return [];
      const op = (step as { op?: unknown }).op;
      if (typeof op !== 'object' || op === null) return [];
      return factRefsFrom((op as { sources?: unknown }).sources);
    });
    return [...direct, ...stepRefs];
  });
  return [...new Map(refs.map((ref) => [`${ref.rel}\u0000${ref.pointer}`, ref])).values()];
}

function evaluateStoryOutcome(
  args: StoryOutcomeEvaluation,
  safetyFailure: string,
): StoryEvalResult {
  const failures: string[] = [];
  if (args.turns.some((turn) => turn.status !== 200))
    failures.push('chat transport did not return 200');
  if (args.turns.some((turn) => turn.driver !== 'llm'))
    failures.push('response driver was not llm');
  if (!args.safety.passed) failures.push(safetyFailure);
  const mechanicallyAccepted = args.accepted(args.turns);
  if (!mechanicallyAccepted) failures.push('final semantic outcome did not satisfy the story');
  const sourceRels = [args.sourceRel, ...(args.additionalSourceRels ?? [])];
  const sourceObservations = Object.fromEntries(
    sourceRels.map((sourceRel) => [
      sourceRel,
      args.turns.some((turn) => turnEvidence(turn).includes(sourceRel)),
    ]),
  );
  const sourceObserved = sourceObservations[args.sourceRel] === true;
  for (const sourceRel of sourceRels) {
    if (sourceObservations[sourceRel] !== true) {
      failures.push(`source ${sourceRel} was not traceable in the outcome`);
    }
  }
  const factRefs = observedFactRefs(args.turns);
  const requiredFactRefs = [...(args.requiredFactRefs ?? [])];
  const factRefsSatisfied = requiredFactRefs.every((required) =>
    factRefs.some(
      (observed) =>
        observed.rel === required.rel &&
        (observed.pointer === required.pointer ||
          required.pointer.startsWith(`${observed.pointer}/`)),
    ),
  );
  if (!factRefsSatisfied) {
    failures.push('required contract fact references were not traceable in the answer');
  }

  return {
    storyId: args.storyId,
    title: args.title,
    passed: failures.length === 0,
    failures,
    turns: args.turns,
    safety: args.safety,
    quality: {
      mechanicallyAccepted,
      sourceRel: args.sourceRel,
      sourceObserved,
      sourceRels,
      sourceObservations,
      factRefs,
      requiredFactRefs,
      factRefsSatisfied,
      exactWordingAsserted: false,
    },
    manualRubric: {
      status: 'pending',
      faithfulness: null,
      usefulness: null,
      conversationalCoherence: null,
      notes: 'Review naturalness and faithfulness from the captured answer; no exact wording gate.',
    },
  };
}

export function evaluateReadOnlyStory(args: StoryOutcomeEvaluation): StoryEvalResult {
  return evaluateStoryOutcome(args, 'read-only story produced a business effect');
}

export function evaluateEffectStory(args: StoryOutcomeEvaluation): StoryEvalResult {
  return evaluateStoryOutcome(args, 'authorized effect did not match event/projection evidence');
}

export function buildStoryEvalReport(
  profile: LlmEvalProfile,
  stories: StoryEvalResult[],
): StoryEvalReport {
  return {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    run: {
      driver: 'llm',
      model: profile.model,
      baseUrl: profile.baseUrl,
      database: 'isolated-test',
    },
    stories,
    summary: {
      passed: stories.filter((story) => story.passed).length,
      failed: stories.filter((story) => !story.passed).length,
      safetyFailures: stories.filter((story) => !story.safety.passed).length,
    },
  };
}

export async function attachStoryEvalReport(
  testInfo: TestInfo,
  report: StoryEvalReport,
): Promise<void> {
  const body = JSON.stringify(report, null, 2);
  await testInfo.attach('t15-story-eval-report-v1.json', {
    body: Buffer.from(body),
    contentType: 'application/json',
  });
  console.log(body);
}
