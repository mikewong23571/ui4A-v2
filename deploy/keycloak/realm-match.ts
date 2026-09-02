import {
  expectedClientScopeAssignments,
  managedClientIds,
  object,
  type RealmImportRepresentation,
} from './realm-contract';

function hasAccessTokenAudience(client: Record<string, unknown>, audience: string): boolean {
  const mappers = Array.isArray(client.protocolMappers) ? client.protocolMappers : [];
  return mappers.some((candidate) => {
    const mapper = object(candidate);
    const config = object(mapper?.config);
    return (
      mapper?.protocol === 'openid-connect' &&
      mapper.protocolMapper === 'oidc-audience-mapper' &&
      config?.['included.client.audience'] === audience &&
      config['access.token.claim'] === 'true' &&
      config['id.token.claim'] === 'false'
    );
  });
}

function hasExactAccessTokenSubjectMapper(client: Record<string, unknown>): boolean {
  const mappers = Array.isArray(client.protocolMappers) ? client.protocolMappers : [];
  const subjects = mappers.filter((candidate) => {
    const mapper = object(candidate);
    return mapper?.name === 'subject' || mapper?.protocolMapper === 'oidc-sub-mapper';
  });
  if (subjects.length !== 1) return false;

  const mapper = object(subjects[0]);
  const config = object(mapper?.config);
  return (
    mapper?.name === 'subject' &&
    mapper.protocol === 'openid-connect' &&
    mapper.protocolMapper === 'oidc-sub-mapper' &&
    config !== undefined &&
    Object.keys(config).length === 5 &&
    config['access.token.claim'] === 'true' &&
    config['introspection.token.claim'] === 'true' &&
    config['lightweight.claim'] === 'true' &&
    config['id.token.claim'] === 'false' &&
    config['userinfo.token.claim'] === 'false'
  );
}

function sameStringSet(input: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(input) &&
    input.every((entry) => typeof entry === 'string') &&
    input.length === expected.length &&
    [...input].sort().every((entry, index) => entry === [...expected].sort()[index])
  );
}

export function realmMatches(
  realm: Record<string, unknown>,
  clients: Array<Record<string, unknown>>,
  expected: RealmImportRepresentation,
): boolean {
  const realmAttributes = object(realm.attributes);
  if (
    realm.enabled !== true ||
    realm.offlineSessionIdleTimeout !== expected.offlineSessionIdleTimeout ||
    realm.offlineSessionMaxLifespanEnabled !== expected.offlineSessionMaxLifespanEnabled ||
    realm.offlineSessionMaxLifespan !== expected.offlineSessionMaxLifespan ||
    realmAttributes?.['ui4a.experimental.contract.version'] !==
      expected.attributes['ui4a.experimental.contract.version']
  ) {
    return false;
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const candidate of clients) {
    if (
      typeof candidate.clientId !== 'string' ||
      !managedClientIds.includes(candidate.clientId as never)
    ) {
      continue;
    }
    if (byId.has(candidate.clientId)) return false;
    byId.set(candidate.clientId, candidate);
  }
  if (managedClientIds.some((clientId) => !byId.has(clientId))) return false;

  const web = byId.get('ui4a-web')!;
  const expectedWeb = expected.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
  const webAttributes = object(web.attributes);
  const expectedWebAttributes = expectedWeb.attributes!;
  if (
    web.enabled !== true ||
    web.publicClient !== false ||
    web.bearerOnly !== false ||
    web.standardFlowEnabled !== true ||
    web.serviceAccountsEnabled !== false ||
    web.directAccessGrantsEnabled !== false ||
    webAttributes?.['pkce.code.challenge.method'] !== 'S256' ||
    webAttributes['post.logout.redirect.uris'] !==
      expectedWebAttributes['post.logout.redirect.uris'] ||
    !sameStringSet(web.defaultClientScopes, expectedClientScopeAssignments['ui4a-web'].defaults) ||
    !sameStringSet(web.optionalClientScopes, expectedClientScopeAssignments['ui4a-web'].optional) ||
    !hasExactAccessTokenSubjectMapper(web) ||
    !hasAccessTokenAudience(web, 'ui4a-api') ||
    !hasAccessTokenAudience(web, 'ui4a-agent') ||
    !sameStringSet(web.redirectUris, expectedWeb.redirectUris ?? [])
  ) {
    return false;
  }

  const agent = byId.get('ui4a-agent')!;
  const agentAttributes = object(agent.attributes);
  if (
    agent.enabled !== true ||
    agent.publicClient !== false ||
    agent.bearerOnly !== false ||
    agent.standardFlowEnabled !== false ||
    agent.serviceAccountsEnabled !== true ||
    agent.directAccessGrantsEnabled !== false ||
    agentAttributes?.['standard.token.exchange.enabled'] !== 'true' ||
    !sameStringSet(
      agent.defaultClientScopes,
      expectedClientScopeAssignments['ui4a-agent'].defaults,
    ) ||
    !sameStringSet(
      agent.optionalClientScopes,
      expectedClientScopeAssignments['ui4a-agent'].optional,
    ) ||
    !hasAccessTokenAudience(agent, 'ui4a-api')
  ) {
    return false;
  }

  const cli = byId.get('ui4a-cli')!;
  const cliAttributes = object(cli.attributes);
  if (
    cli.enabled !== true ||
    cli.publicClient !== true ||
    cli.bearerOnly !== false ||
    cli.standardFlowEnabled !== false ||
    cli.serviceAccountsEnabled !== false ||
    cli.directAccessGrantsEnabled !== false ||
    cliAttributes?.['oauth2.device.authorization.grant.enabled'] !== 'true' ||
    cliAttributes['access.token.lifespan'] !== '86400' ||
    cliAttributes['client.offline.session.idle.timeout'] !== '7776000' ||
    cliAttributes['client.offline.session.max.lifespan'] !== '15552000' ||
    !sameStringSet(cli.defaultClientScopes, expectedClientScopeAssignments['ui4a-cli'].defaults) ||
    !sameStringSet(cli.optionalClientScopes, expectedClientScopeAssignments['ui4a-cli'].optional) ||
    !hasExactAccessTokenSubjectMapper(cli) ||
    !hasAccessTokenAudience(cli, 'ui4a-api') ||
    typeof cli.secret === 'string'
  ) {
    return false;
  }

  const api = byId.get('ui4a-api')!;
  return (
    api.enabled === true &&
    api.publicClient === false &&
    api.bearerOnly === true &&
    api.standardFlowEnabled === false &&
    api.serviceAccountsEnabled === false &&
    api.directAccessGrantsEnabled === false &&
    sameStringSet(api.defaultClientScopes, expectedClientScopeAssignments['ui4a-api'].defaults) &&
    sameStringSet(api.optionalClientScopes, expectedClientScopeAssignments['ui4a-api'].optional)
  );
}
