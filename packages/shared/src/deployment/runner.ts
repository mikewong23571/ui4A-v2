/**
 * Runner 作用域部署配置解析(自 production-deployment-config.ts 按配置域拆出,行为不变)。
 */
import { parseProductionDeploymentConfig } from './config';
import { exactObject, fail, parseSecrets, requireSecret } from './primitives';
import type { ProductionDeploymentConfig, ProductionRunnerSelection } from './types';

function collectConfiguredSecretRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) collectConfiguredSecretRefs(child, refs);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith('Ref') && typeof child === 'string' && child.trim() !== '') {
      refs.add(child);
    } else if (key === 'credentialRefs' && Array.isArray(child)) {
      for (const ref of child) {
        if (typeof ref === 'string' && ref.trim() !== '') refs.add(ref);
      }
    }
    collectConfiguredSecretRefs(child, refs);
  }
}

/**
 * Validate the canonical settings while exposing only one server-selected Runner credential scope.
 * The validation-only placeholders never leave this function and cannot become runtime material.
 */
export function parseProductionRunnerDeploymentConfig(
  input: unknown,
  selection: ProductionRunnerSelection,
): ProductionDeploymentConfig {
  const candidate = exactObject(input, 'deploymentConfig', ['settings', 'secrets']);
  const scopedSecrets = parseSecrets(candidate.secrets);
  const configuredRefs = new Set<string>();
  collectConfiguredSecretRefs(candidate.settings, configuredRefs);
  const validationSecrets = Object.fromEntries(
    [...configuredRefs].map((ref, index) => [ref, `__runner_config_validation_${index}_${ref}__`]),
  );
  Object.assign(validationSecrets, scopedSecrets);
  const parsed = parseProductionDeploymentConfig({
    settings: candidate.settings,
    secrets: validationSecrets,
  });

  const profiles = parsed.settings.runtime.profiles.filter((profile) =>
    selection.backend === 'kubernetes'
      ? profile.backend === 'kubernetes' && profile.id === selection.profileId
      : profile.backend === 'host' && profile.runnerId === selection.runnerId,
  );
  if (profiles.length === 0 || (selection.backend === 'kubernetes' && profiles.length !== 1)) {
    fail(
      'runner.selection',
      selection.backend === 'kubernetes'
        ? 'must resolve exactly one server-owned runtime profile'
        : 'must resolve at least one server-owned runtime profile',
    );
  }
  if (
    (selection.backend === 'kubernetes' && parsed.settings.deploymentMode !== 'kubernetes') ||
    (selection.backend === 'host' && parsed.settings.deploymentMode !== 'compose')
  ) {
    fail('runner.selection', 'must match the production deployment mode');
  }
  const allowedRefs = new Set([parsed.settings.llm.apiKeyRef]);
  for (const profile of profiles) {
    for (const ref of profile.credentialRefs) allowedRefs.add(ref);
    if (profile.backend === 'host') allowedRefs.add(profile.runnerTokenRef);
  }
  const unexpected = Object.keys(scopedSecrets).find((ref) => !allowedRefs.has(ref));
  if (unexpected !== undefined) {
    fail(`secrets.${unexpected}`, 'is outside the selected Runner Secret scope');
  }
  for (const ref of allowedRefs) {
    requireSecret(scopedSecrets, ref, 'runner.secrets');
  }
  return { settings: parsed.settings, secrets: Object.freeze({ ...scopedSecrets }) };
}
