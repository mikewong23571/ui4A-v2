import {
  internalCallbackPaths,
  keycloakEdgeMatches,
  webEdgeMatches,
  type EdgeMatch,
  type EdgeMethod,
} from './edge-matches';
import type { KubernetesObject, Ui4aHelmValues, UnknownRecord } from './values';
import { metadata, selector } from './workload-helpers';

function virtualServiceMatch(match: EdgeMatch): UnknownRecord {
  return {
    method: { exact: match.method },
    uri: { [match.kind ?? 'exact']: match.path },
  };
}

function edgeRoute(matches: readonly EdgeMatch[], host: string, port: number): UnknownRecord {
  return {
    match: matches.map(virtualServiceMatch),
    route: [{ destination: { host, port: { number: port } } }],
  };
}

function authorizationRule(matches: readonly EdgeMatch[], method: EdgeMethod): UnknownRecord {
  return {
    to: [
      {
        operation: {
          methods: [method],
          paths: matches
            .filter((match) => match.method === method)
            .map((match) => (match.kind === 'prefix' ? `${match.path}*` : match.path)),
        },
      },
    ],
  };
}

export function renderIstioResources(values: Ui4aHelmValues): KubernetesObject[] {
  const namespace = values.namespace.name;
  return [
    {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'Gateway',
      metadata: metadata(values.istio.gateway, namespace),
      spec: {
        selector: { istio: 'ingressgateway' },
        servers: [
          {
            port: { number: 443, name: 'https', protocol: 'HTTPS' },
            tls: { mode: 'SIMPLE', credentialName: values.istio.tlsCredentialName },
            hosts: [values.hosts.web, values.hosts.keycloak],
          },
        ],
      },
    },
    {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'VirtualService',
      metadata: metadata('ui4a-web', namespace),
      spec: {
        hosts: [values.hosts.web],
        gateways: [values.istio.gateway],
        http: [
          {
            match: internalCallbackPaths.map((path) => ({
              method: { exact: 'POST' },
              uri: { exact: path },
            })),
            directResponse: { status: 404 },
          },
          edgeRoute(webEdgeMatches, 'web', 3100),
          { directResponse: { status: 404 } },
        ],
      },
    },
    {
      apiVersion: 'networking.istio.io/v1beta1',
      kind: 'VirtualService',
      metadata: metadata('ui4a-keycloak', namespace),
      spec: {
        hosts: [values.hosts.keycloak],
        gateways: [values.istio.gateway],
        http: [
          {
            match: [
              { uri: { prefix: '/admin/' } },
              { uri: { prefix: '/realms/master/' } },
              { uri: { exact: '/metrics' } },
              { uri: { prefix: '/metrics/' } },
              { uri: { exact: '/health' } },
              { uri: { prefix: '/health/' } },
            ],
            directResponse: { status: 404 },
          },
          edgeRoute(keycloakEdgeMatches, 'keycloak', 8080),
          { directResponse: { status: 404 } },
        ],
      },
    },
    {
      apiVersion: 'security.istio.io/v1beta1',
      kind: 'RequestAuthentication',
      metadata: metadata('ui4a-web-jwt', namespace),
      spec: {
        selector: { matchLabels: selector('web') },
        jwtRules: [
          {
            issuer: values.istio.oidcIssuer,
            audiences: [values.istio.oidcAudience],
            jwksUri: values.istio.jwksUri,
            forwardOriginalToken: true,
          },
        ],
      },
    },
    {
      apiVersion: 'security.istio.io/v1beta1',
      kind: 'AuthorizationPolicy',
      metadata: metadata('ui4a-web', namespace),
      spec: {
        selector: { matchLabels: selector('web') },
        action: 'ALLOW',
        rules: [
          authorizationRule(webEdgeMatches, 'GET'),
          authorizationRule(webEdgeMatches, 'POST'),
          {
            from: [
              {
                source: {
                  principals: [`cluster.local/ns/${namespace}/sa/${values.serviceAccounts.worker}`],
                },
              },
            ],
            to: [
              {
                operation: {
                  methods: ['POST'],
                  paths: [...internalCallbackPaths],
                },
              },
            ],
          },
        ],
      },
    },
  ];
}
