import Ajv from 'ajv';

import type {
  AgentArtifactRef,
  AgentDefinition,
  AgentProposedEffect,
  AgentResultEnvelope as SpecializedAgentResultEnvelope,
} from '@ui4a/shared';

export type AgentResultProposalCheckName =
  | 'run-identity-valid'
  | 'output-schema-valid'
  | 'artifact-policy-valid'
  | 'artifact-integrity-valid'
  | 'verifier-evidence-valid';

export interface AgentResultProposalCheck {
  name: AgentResultProposalCheckName;
  pass: boolean;
  detail?: string[];
}

export interface VerifiedAgentVerifierResult {
  passed: boolean;
  artifactHash?: string;
}

export interface AgentResultProposalReport {
  pass: boolean;
  checks: AgentResultProposalCheck[];
  proposedEffects: AgentProposedEffect[];
  /** Result validation never executes Application effects. */
  executedEffects: [];
}

function check(name: AgentResultProposalCheckName, detail: string[]): AgentResultProposalCheck {
  return { name, pass: detail.length === 0, ...(detail.length === 0 ? {} : { detail }) };
}

function sameArtifact(left: AgentArtifactRef, right: AgentArtifactRef): boolean {
  return (
    left.hash === right.hash &&
    left.mediaType === right.mediaType &&
    left.sizeBytes === right.sizeBytes
  );
}

/**
 * Validate one specialization result against its activated contract and independently observed
 * artifact/verifier evidence. Proposed effects are returned as data and are never executed here.
 */
export function validateAgentResultProposal(input: {
  definition: AgentDefinition;
  result: SpecializedAgentResultEnvelope;
  expectedRunId: string;
  verifiedArtifacts: ReadonlyMap<string, AgentArtifactRef>;
  verifiedVerifiers: ReadonlyMap<string, VerifiedAgentVerifierResult>;
}): AgentResultProposalReport {
  const identityIssues: string[] = [];
  const schemaIssues: string[] = [];
  const artifactPolicyIssues: string[] = [];
  const artifactIntegrityIssues: string[] = [];
  const verifierIssues: string[] = [];

  if (input.result.runId !== input.expectedRunId) {
    identityIssues.push(`result runId ${input.result.runId} does not match ${input.expectedRunId}`);
  }
  if (input.result.provenance.birth.definitionRef !== input.definition.ref) {
    identityIssues.push('result birth definition does not match the activated definition');
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(input.definition.contracts.outputSchema);
  if (!validate(input.result.output)) {
    schemaIssues.push(
      ...(validate.errors ?? []).map(
        (error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
      ),
    );
  }

  const policy = input.definition.policies.artifacts;
  if (input.result.artifacts.length > policy.maxCount) {
    artifactPolicyIssues.push(`artifact count exceeds ${policy.maxCount}`);
  }
  const totalBytes = input.result.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
  if (totalBytes > policy.maxBytes) {
    artifactPolicyIssues.push(`artifact bytes exceed ${policy.maxBytes}`);
  }
  for (const artifact of input.result.artifacts) {
    if (!policy.allowedMediaTypes.includes(artifact.mediaType)) {
      artifactPolicyIssues.push(`artifact media type ${artifact.mediaType} is not allowed`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(artifact.hash)) {
      artifactIntegrityIssues.push(`artifact ${artifact.hash} is not content addressed`);
      continue;
    }
    const verified = input.verifiedArtifacts.get(artifact.hash);
    if (verified === undefined || !sameArtifact(artifact, verified)) {
      artifactIntegrityIssues.push(`artifact ${artifact.hash} does not match verified content`);
    }
  }

  for (const verifier of input.definition.evaluationPolicy.verifiers) {
    const claimed = input.result.evidence.find((evidence) => evidence.verifier === verifier);
    const verified = input.verifiedVerifiers.get(verifier);
    if (claimed === undefined || !claimed.passed) {
      verifierIssues.push(`result is missing a passing ${verifier} claim`);
      continue;
    }
    if (verified === undefined || !verified.passed) {
      verifierIssues.push(`verifier ${verifier} was not independently observed passing`);
      continue;
    }
    if (verified.artifactHash !== undefined && claimed.artifact.hash !== verified.artifactHash) {
      verifierIssues.push(`verifier ${verifier} references a different artifact`);
    }
  }

  const checks = [
    check('run-identity-valid', identityIssues),
    check('output-schema-valid', schemaIssues),
    check('artifact-policy-valid', artifactPolicyIssues),
    check('artifact-integrity-valid', artifactIntegrityIssues),
    check('verifier-evidence-valid', verifierIssues),
  ];
  return {
    pass: checks.every((entry) => entry.pass),
    checks,
    proposedEffects: input.result.proposedEffects.map((effect) => ({ ...effect })),
    executedEffects: [],
  };
}
