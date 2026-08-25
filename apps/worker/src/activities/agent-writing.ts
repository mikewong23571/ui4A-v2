/** Writing specialization 的 activity 绑定:env deps、production 端口与组合绑定。 */
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import {
  collectWritingAgentRunWithDeps,
  executeWritingAgentRunWithDeps,
  finalizeWritingAgentRunWithDeps,
  parseDocumentAgentProfiles,
  prepareWritingAgentRunWithDeps,
  verifyWritingAgentRun,
  writingPreparedWorkspaceRoot,
  type WritingAgentAdapterDeps,
} from '../agents/writing';
import { composeProductionWritingAgent } from '../agents/writing/production';
import type { ProductionRuntimeSpecializationPort } from '../runtime-backends/production-wiring';
import { workerDb } from '../worker-db';
import { remoteStructuredExecutor } from './agent-remote';
import type { AgentSpecializationBinding } from './agent-shared';

export function writingAgentAdapterDeps(): WritingAgentAdapterDeps {
  const workspaceRoot = process.env.UI4A_DOCUMENT_WORKSPACE_ROOT;
  const profiles = process.env.UI4A_DOCUMENT_AGENT_PROFILES;
  if (workspaceRoot === undefined || profiles === undefined) {
    throw new Error(
      'writing-agent requires UI4A_DOCUMENT_WORKSPACE_ROOT and UI4A_DOCUMENT_AGENT_PROFILES',
    );
  }
  return {
    db: workerDb(),
    workspaceRoot,
    profiles: parseDocumentAgentProfiles(profiles),
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
}

/** Composition binding: the writing specialization contributes one adapter object. */
export const writingBinding: AgentSpecializationBinding = {
  name: 'writing',
  taskKind: 'writing-task',
  prepare: (args) => prepareWritingAgentRunWithDeps(args, writingAgentAdapterDeps()),
  execute: (args) => executeWritingAgentRunWithDeps(args, writingAgentAdapterDeps()),
  collect: (args) => collectWritingAgentRunWithDeps(args, writingAgentAdapterDeps()),
  verify: verifyWritingAgentRun,
  finalize: (input) => finalizeWritingAgentRunWithDeps(input, writingAgentAdapterDeps()),
};

/** Production port: the prepared workspace must match the deployment-composed root. */
export function writingProductionPort(
  config: ProductionDeploymentConfig,
): ProductionRuntimeSpecializationPort {
  const productionWriting = composeProductionWritingAgent(config);
  const writingDeps: WritingAgentAdapterDeps = {
    db: workerDb(process.env, config),
    workspaceRoot: productionWriting.workspaceRoot,
    profiles: productionWriting.profiles,
    probe: productionWriting.probe,
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
  return {
    taskKind: 'writing-task',
    prepare: (context) => prepareWritingAgentRunWithDeps(context, writingDeps),
    executeProduction: async (input) => {
      const workspaceRoot = writingPreparedWorkspaceRoot(input.prepared);
      if (workspaceRoot !== productionWriting.workspaceRootForRun(input.context.runId)) {
        throw new Error('production_writing_workspace_mismatch');
      }
      return executeWritingAgentRunWithDeps(
        { context: input.context, prepared: input.prepared },
        {
          ...writingDeps,
          execute: remoteStructuredExecutor({
            ...input,
            profile: { ...input.profile, workspaceRoot },
          }),
        },
      );
    },
    collect: (input) => collectWritingAgentRunWithDeps(input, writingDeps),
    verify: verifyWritingAgentRun,
    finalize: (input) => finalizeWritingAgentRunWithDeps(input, writingDeps),
  };
}
