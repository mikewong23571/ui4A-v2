import { composeServices } from './compose-services';
import {
  retainedVolume,
  siblingSecretFile,
  stateSecretNames,
  validateInput,
} from './compose-shared';
import type { ComposeRenderInput, ComposeStack } from './compose-types';

export { composeImageKeys } from './compose-types';
export type {
  ComposeDependencyCondition,
  ComposeImageKey,
  ComposeRenderInput,
  ComposeService,
  ComposeStack,
} from './compose-types';

/**
 * Render the deterministic Compose object shared by the static artifact generator and contract
 * tests. It accepts paths and immutable image identities only; Secret material is never an input.
 */
export function renderComposeStack(input: ComposeRenderInput): ComposeStack {
  validateInput(input);

  return {
    name: 'ui4a',
    services: composeServices(input),
    volumes: Object.fromEntries(
      [
        'postgres-data',
        'backup-data',
        'realm-data',
        'experiment-ca',
        'runner-workspaces',
        'runner-artifacts',
        'runtime-config',
        'runner-config',
        'host-runner-config',
      ].map((name) => [name, retainedVolume(name)]),
    ),
    configs: {
      'ui4a-deployment-settings': { file: input.settingsFile },
      'ui4a-config-init': { file: 'deploy/compose/config-init.mjs' },
      'temporal-static-config': { file: 'deploy/compose/temporal-config.yaml' },
      'temporal-dynamic-config': { file: 'deploy/compose/temporal-dynamicconfig.yaml' },
    },
    secrets: {
      'ui4a-deployment-secrets': { file: input.secretsFile },
      ...Object.fromEntries(
        stateSecretNames.map((name) => [
          name,
          { file: siblingSecretFile(input.secretsFile, name) },
        ]),
      ),
    },
    'x-ui4a-contract': {
      schemaVersion: 1,
      replicas: 1,
      highAvailability: false,
      realmLifecycle: 'import-or-check-and-skip',
    },
  };
}
