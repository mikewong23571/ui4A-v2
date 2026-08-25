/**
 * runtime 段(profile/repository)解析(自 production-deployment-config.ts 按配置域拆出,
 * 行为不变)。模块内部使用,不经 barrel 导出。
 */
import {
  absolutePath,
  enumValue,
  exactObject,
  fail,
  identifier,
  integer,
  object,
  string,
  stringList,
} from './primitives';
import type {
  ProductionAgentSpecialization,
  ProductionDeploymentSettings,
  ProductionRepository,
  ProductionRuntimeProfile,
} from './types';

function parseResources(value: unknown, path: string): { cpu: string; memory: string } {
  const candidate = exactObject(value, path, ['cpu', 'memory']);
  const cpu = string(candidate.cpu, `${path}.cpu`);
  const memory = string(candidate.memory, `${path}.memory`);
  if (!/^(?:[1-9]\d*m|[1-9]\d*(?:\.\d+)?)$/.test(cpu)) {
    fail(`${path}.cpu`, 'must be a positive CPU quantity');
  }
  if (!/^[1-9]\d*(?:Ki|Mi|Gi|Ti)$/.test(memory)) {
    fail(`${path}.memory`, 'must be a positive binary memory quantity');
  }
  return {
    cpu,
    memory,
  };
}

function parseProfile(value: unknown, index: number): ProductionRuntimeProfile {
  const path = `settings.runtime.profiles[${index}]`;
  const candidate = object(value, path);
  const backend = enumValue(candidate.backend, `${path}.backend`, ['kubernetes', 'host'] as const);
  const commonKeys = [
    'id',
    'specialization',
    'backend',
    'workspaceRoot',
    'timeoutSeconds',
    'resources',
    'networkPolicy',
    'credentialRefs',
  ];
  exactObject(candidate, path, [
    ...commonKeys,
    ...(backend === 'kubernetes' ? ['image'] : ['runnerId', 'runnerTokenRef']),
  ]);
  const common = {
    id: identifier(candidate.id, `${path}.id`),
    specialization: enumValue(candidate.specialization, `${path}.specialization`, [
      'coding',
      'writing',
      'authoring',
    ] as const),
    workspaceRoot: absolutePath(candidate.workspaceRoot, `${path}.workspaceRoot`),
    timeoutSeconds: integer(candidate.timeoutSeconds, `${path}.timeoutSeconds`),
    resources: parseResources(candidate.resources, `${path}.resources`),
    networkPolicy: enumValue(candidate.networkPolicy, `${path}.networkPolicy`, [
      'restricted',
    ] as const),
    credentialRefs: stringList(candidate.credentialRefs, `${path}.credentialRefs`).map(
      (ref, refIndex) => identifier(ref, `${path}.credentialRefs[${refIndex}]`),
    ),
  };
  if (backend === 'kubernetes') {
    const image = string(candidate.image, `${path}.image`);
    if (!/@sha256:[a-f0-9]{64}$/.test(image)) {
      fail(`${path}.image`, 'production Runtime image must be pinned by sha256 digest');
    }
    return { ...common, backend, image };
  }
  return {
    ...common,
    backend,
    runnerId: identifier(candidate.runnerId, `${path}.runnerId`),
    runnerTokenRef: identifier(candidate.runnerTokenRef, `${path}.runnerTokenRef`),
  };
}

function parseRepository(value: unknown, index: number): ProductionRepository {
  const path = `settings.runtime.repositories[${index}]`;
  const candidate = exactObject(value, path, ['ref', 'root', 'allowedPaths']);
  const allowedPaths = stringList(candidate.allowedPaths, `${path}.allowedPaths`);
  for (const [allowedIndex, allowedPath] of allowedPaths.entries()) {
    if (
      allowedPath.startsWith('/') ||
      allowedPath === '.' ||
      allowedPath.includes('..') ||
      allowedPath.includes('\0')
    ) {
      fail(`${path}.allowedPaths[${allowedIndex}]`, 'must be a bounded relative path');
    }
  }
  return {
    ref: identifier(candidate.ref, `${path}.ref`),
    root: absolutePath(candidate.root, `${path}.root`),
    allowedPaths,
  };
}

export function parseRuntime(value: unknown): ProductionDeploymentSettings['runtime'] {
  const candidate = exactObject(value, 'settings.runtime', [
    'defaultProfiles',
    'profiles',
    'repositories',
  ]);
  const defaults = exactObject(candidate.defaultProfiles, 'settings.runtime.defaultProfiles', [
    'coding',
    'writing',
    'authoring',
  ]);
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) {
    fail('settings.runtime.profiles', 'must be a non-empty array');
  }
  if (!Array.isArray(candidate.repositories) || candidate.repositories.length === 0) {
    fail('settings.runtime.repositories', 'must be a non-empty array');
  }
  const profiles = candidate.profiles.map(parseProfile);
  const repositories = candidate.repositories.map(parseRepository);
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id))
      fail('settings.runtime.profiles', `duplicate profile id ${profile.id}`);
    ids.add(profile.id);
  }
  const repositoryRefs = new Set<string>();
  for (const repository of repositories) {
    if (repositoryRefs.has(repository.ref)) {
      fail('settings.runtime.repositories', `duplicate repository ref ${repository.ref}`);
    }
    repositoryRefs.add(repository.ref);
  }
  const defaultProfiles: Record<ProductionAgentSpecialization, string> = {
    coding: identifier(defaults.coding, 'settings.runtime.defaultProfiles.coding'),
    writing: identifier(defaults.writing, 'settings.runtime.defaultProfiles.writing'),
    authoring: identifier(defaults.authoring, 'settings.runtime.defaultProfiles.authoring'),
  };
  for (const specialization of ['coding', 'writing', 'authoring'] as const) {
    const matches = profiles.filter(
      (profile) =>
        profile.id === defaultProfiles[specialization] && profile.specialization === specialization,
    );
    if (matches.length !== 1) {
      fail(
        `settings.runtime.defaultProfiles.${specialization}`,
        'must resolve exactly one sealed server-owned profile of the same specialization',
      );
    }
  }
  return { defaultProfiles, profiles, repositories };
}
