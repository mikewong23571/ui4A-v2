import { flowForInstance, inspectJsonBudget, type AgentRun, type AgentRunJson } from '@ui4a/engine';
import { assertAgentAuthoringResult } from '@ui4a/shared';

import type { DbExecutor } from '../db/events';
import { agentDefinitionDraftRegistryPort } from './agent-definitions';
import { executeDraftMeta } from './drafts';
import type { EngineRuntime } from './service';

/** Local Application seam until result bridges become a shared definition-language vocabulary. */
interface AgentDefinitionDraftBridge {
  kind: 'agent-definition-draft';
}

interface AgentDefinitionDraftCandidate {
  source: unknown;
  examples: AgentRunJson[];
  evalCorpus: AgentRunJson[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function declaredBridge(
  engine: EngineRuntime,
  run: AgentRun,
): AgentDefinitionDraftBridge | undefined {
  const snapshot = engine.getSnapshot();
  const instance = snapshot.instances[run.source.rel];
  if (instance === undefined) return undefined;
  const flows = Object.fromEntries(
    Object.entries(snapshot.definitions ?? {}).map(([name, entry]) => [name, entry.definition]),
  );
  const flow = flowForInstance({ flows, versions: snapshot.definitionVersions }, instance);
  const action = flow?.nodes
    .find((node) => node.name === instance.node)
    ?.actions.find((candidate) => candidate.name === run.source.onDoneAction) as
    (Record<string, unknown> & { 'agent-result-bridge'?: unknown }) | undefined;
  const bridge = action?.['agent-result-bridge'];
  return record(bridge) && bridge.kind === 'agent-definition-draft'
    ? { kind: bridge.kind }
    : undefined;
}

function parseCandidate(run: AgentRun): AgentDefinitionDraftCandidate {
  if (run.result === undefined || run.result.proposedEffects.length > 0) {
    throw new Error('Agent Definition authoring result must be an effect-free proposal');
  }
  const payload = run.result.payload;
  const result = assertAgentAuthoringResult(record(payload) ? payload.authoringResult : undefined);
  if (result.status !== 'completed') throw new Error('Agent Definition authoring did not complete');
  const budget = inspectJsonBudget({ value: result });
  if (!budget.valid) {
    throw new Error(
      `Agent Definition authoring result exceeds budget: ${budget.issues.join('; ')}`,
    );
  }
  if (result.examples.length > 64 || result.evalCorpus.length > 64) {
    throw new Error('Agent Definition authoring examples/Eval corpus exceeds 64 entries');
  }
  const evidenceKinds = new Set(run.result.evidence.map((evidence) => evidence.kind));
  const draftOnly = run.result.evidence.find(
    (evidence) =>
      evidence.kind === 'agent-definition-draft-only' &&
      record(evidence.detail) &&
      evidence.detail.passed === true &&
      evidence.detail.approval === false &&
      evidence.detail.activation === false,
  );
  if (
    draftOnly === undefined ||
    !evidenceKinds.has('agent-definition-source-parse') ||
    !evidenceKinds.has('agent-definition-non-eval-invariants') ||
    !evidenceKinds.has('agent-definition-eval-corpus-proposed')
  ) {
    throw new Error('Agent Definition authoring result lacks mechanical Draft-only evidence');
  }
  return {
    source: result.candidate,
    examples: result.examples as unknown as AgentRunJson[],
    evalCorpus: result.evalCorpus as unknown as AgentRunJson[],
  };
}

/**
 * Materialize a declared authoring result through the existing T17 Draft service.
 *
 * The bridge is enabled only by the birth-version callback action. It creates/reuses one Draft
 * command and never submits, approves, activates, or writes the Agent Definition registry.
 */
export async function materializeDeclaredAgentDefinitionDraft(
  db: DbExecutor,
  engine: EngineRuntime,
  run: AgentRun,
): Promise<{ draftRel: string; examples: number; evalCases: number } | undefined> {
  if (declaredBridge(engine, run) === undefined) return undefined;
  const candidate = parseCandidate(run);
  if (!record(candidate.source) || typeof candidate.source.name !== 'string') {
    throw new Error('Agent Definition Draft candidate requires a target name');
  }
  const target = candidate.source.name;
  const commandId = `agent-run:${run.runId}:agent-definition-draft`;
  const outcome = await executeDraftMeta(
    db,
    engine,
    {
      rel: 'meta/drafts',
      action: 'create',
      actor: 'agent',
      principal: run.principal,
      channel: 'agent-run-callback',
      params: {
        kind: 'agent-definition',
        target,
        policyScope: run.policyScope,
        commandId,
        payload: candidate.source,
        schemaRef: 'ui4a://agent-definition/v1',
        sources: [
          `agent-run:${run.runId}`,
          `agent-result:${run.result!.resultId}`,
          ...run.result!.artifacts.map((artifact) => artifact.ref),
          ...run.result!.evidence.map((evidence) => evidence.ref),
        ],
      },
    },
    { policyScope: run.policyScope, agentDefinitions: agentDefinitionDraftRegistryPort },
  );
  if (outcome.kind !== 'accepted') {
    throw new Error(`Agent Definition Draft materialization rejected: ${outcome.reason}`);
  }
  const draftRel = String(outcome.entity.properties.rel);
  if (!draftRel.startsWith('draft:')) throw new Error('Draft service returned a non-Draft entity');
  return {
    draftRel,
    examples: candidate.examples.length,
    evalCases: candidate.evalCorpus.length,
  };
}
