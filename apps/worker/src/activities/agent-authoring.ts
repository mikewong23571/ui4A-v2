/** Agent-authoring specialization 的 activity 绑定:env deps、production 端口与组合绑定。 */
import {
  collectAgentAuthoringRunWithDeps,
  executeAgentAuthoringRunWithDeps,
  finalizeAgentAuthoringRunWithDeps,
  parseAgentAuthoringProfiles,
  prepareAgentAuthoringRunWithDeps,
  verifyAgentAuthoringRun,
  type AgentAuthoringAdapterDeps,
} from '../agents/authoring';
import type { ProductionRuntimeSpecializationPort } from '../runtime-backends/production-wiring';
import { workerDb } from '../worker-db';
import { remoteStructuredExecutor } from './agent-remote';
import type { AgentSpecializationBinding } from './agent-shared';

export function agentAuthoringAdapterDeps(): AgentAuthoringAdapterDeps {
  const runtimeRoot = process.env.UI4A_AGENT_AUTHORING_RUNTIME_ROOT;
  const profiles = process.env.UI4A_AGENT_AUTHORING_PROFILES;
  if (runtimeRoot === undefined || profiles === undefined) {
    throw new Error(
      'Agent authoring requires UI4A_AGENT_AUTHORING_RUNTIME_ROOT and UI4A_AGENT_AUTHORING_PROFILES',
    );
  }
  return {
    db: workerDb(),
    runtimeRoot,
    profiles: parseAgentAuthoringProfiles(profiles),
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
}

/** Composition binding: the authoring specialization contributes one adapter object. */
export const authoringBinding: AgentSpecializationBinding = {
  name: 'authoring',
  taskKind: 'agent-definition-authoring-task',
  prepare: (args) => prepareAgentAuthoringRunWithDeps(args, agentAuthoringAdapterDeps()),
  execute: (args) => executeAgentAuthoringRunWithDeps(args, agentAuthoringAdapterDeps()),
  collect: (args) => collectAgentAuthoringRunWithDeps(args, agentAuthoringAdapterDeps()),
  verify: verifyAgentAuthoringRun,
  finalize: (input) => finalizeAgentAuthoringRunWithDeps(input, agentAuthoringAdapterDeps()),
};

/** Production port: remote execution crosses the compiled runtime transport. */
export function authoringProductionPort(): ProductionRuntimeSpecializationPort {
  return {
    taskKind: 'agent-definition-authoring-task',
    prepare: (context) => prepareAgentAuthoringRunWithDeps(context, agentAuthoringAdapterDeps()),
    executeProduction: async (input) =>
      executeAgentAuthoringRunWithDeps(
        { context: input.context, prepared: input.prepared },
        {
          ...agentAuthoringAdapterDeps(),
          probe: async () => ({ available: true }),
          execute: remoteStructuredExecutor(input),
        },
      ),
    collect: (input) => collectAgentAuthoringRunWithDeps(input, agentAuthoringAdapterDeps()),
    verify: verifyAgentAuthoringRun,
    finalize: (input) => finalizeAgentAuthoringRunWithDeps(input, agentAuthoringAdapterDeps()),
  };
}
