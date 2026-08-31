'use client';

import { useEffect, useState } from 'react';

import {
  applicationDirectoryHref,
  entityPageHref,
  locationHrefWithChanges,
} from '@/presence/navigation';

export interface ApplicationOption {
  name: string;
  title: string;
}

export interface ContextReference {
  rel: string;
  title: string;
}

type ReadState<T> = { status: 'loading' | 'error'; value: null } | { status: 'ready'; value: T };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Labels come from the authorized business discovery contract on either site. */
export function applicationOptions(document: unknown): ApplicationOption[] {
  const applications = record(document)?.applications;
  if (!Array.isArray(applications)) return [];
  const result = new Map<string, ApplicationOption>();
  for (const item of applications) {
    const application = record(item);
    const name = text(application?.name);
    const title = text(application?.title);
    if (name !== null && title !== null) result.set(name, { name, title });
  }
  return [...result.values()];
}

/** Reuse the entity renderer's identity-before-title convention; never invent an identity. */
export function contextEntityTitle(document: unknown): string | null {
  const properties = record(record(document)?.properties);
  const rel = text(properties?.rel);
  return (
    [text(properties?.identity), text(properties?.title)].find(
      (value) => value !== null && value !== rel,
    ) ?? null
  );
}

/** Canonical contract read, independent of application selection. */
export function contextEntityEndpoint(rel: string): string | null {
  if (rel.startsWith('workspace:')) return null;
  const base = rel.startsWith('meta/') || rel.startsWith('draft:') ? '/_meta' : '';
  return `${base}/api/entity?rel=${encodeURIComponent(rel)}`;
}

/** Virtual subjects name a view, not an entity; applications still resolve from discovery. */
export function workspaceFocusLabel(subject: string, options: ApplicationOption[]): string | null {
  if (!subject.startsWith('workspace:')) return null;
  if (!subject.startsWith('workspace:app:')) return '工作区';
  const name = subject.slice('workspace:app:'.length);
  return options.find((option) => option.name === name)?.title ?? '无法读取';
}

/** Only explicit, non-dangling thread references participate; no recursive discovery. */
export function threadContextRels(document: unknown): string[] {
  const links = record(document)?.links;
  if (!Array.isArray(links)) return [];
  const refs = new Set<string>();
  for (const value of links) {
    const link = record(value);
    if (
      !Array.isArray(link?.rel) ||
      link.rel.includes('dangling') ||
      !link.rel.some((rel) => rel === 'context' || rel === 'active' || rel === 'approval') ||
      typeof link.href !== 'string'
    )
      continue;
    try {
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) continue;
      if (url.pathname !== '/api/entity' && url.pathname !== '/_meta/api/entity') continue;
      const rel = text(url.searchParams.get('rel'));
      if (rel !== null) refs.add(rel);
    } catch {
      continue;
    }
    if (refs.size === 4) break;
  }
  return [...refs];
}

/** Carry explicit navigation context across human-readable entity links. */
export function contextReferenceHref(route: string, rel: string): string {
  const source = new URL(applicationDirectoryHref(route), 'http://ui4a.local');
  return locationHrefWithChanges(entityPageHref(rel), {
    scope: source.searchParams.get('scope'),
    thread: rel.startsWith('thread:')
      ? rel.slice('thread:'.length)
      : source.searchParams.get('thread'),
    returnTo: source.searchParams.get('returnTo'),
  });
}

async function readDocument(endpoint: string): Promise<unknown> {
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** Component-local read result, discarded on location/reopen; not a navigation or fact store. */
export function useSituationDocument(
  endpoint: string | null,
  refreshKey: string,
): ReadState<unknown> {
  const key = `${endpoint ?? ''}\0${refreshKey}`;
  const [resolved, setResolved] = useState<{ key: string; state: ReadState<unknown> } | null>(null);
  useEffect(() => {
    if (endpoint === null) return;
    let cancelled = false;
    readDocument(endpoint).then(
      (value) => {
        if (!cancelled) setResolved({ key, state: { status: 'ready', value } });
      },
      () => {
        if (!cancelled) setResolved({ key, state: { status: 'error', value: null } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [endpoint, key]);
  return resolved?.key === key ? resolved.state : { status: 'loading', value: null };
}

/** Resolve at most four authorized references, hiding failed reads without stale fallback. */
export function useThreadContextReferences(
  document: unknown,
  enabled: boolean,
): ReadState<ContextReference[]> {
  const rels = enabled ? threadContextRels(document) : [];
  const key = JSON.stringify(rels);
  const [resolved, setResolved] = useState<{
    key: string;
    document: unknown;
    value: ContextReference[];
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refs = JSON.parse(key) as string[];
    void Promise.all(
      refs.map(async (rel): Promise<ContextReference | null> => {
        try {
          const endpoint = contextEntityEndpoint(rel);
          if (endpoint === null) return null;
          const entity = await readDocument(endpoint);
          const title = contextEntityTitle(entity);
          return title === null || title === rel ? null : { rel, title };
        } catch {
          return null;
        }
      }),
    ).then((values) => {
      if (!cancelled)
        setResolved({ key, document, value: values.filter((value) => value !== null) });
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, document]);
  return enabled && resolved?.key === key && resolved.document === document
    ? { status: 'ready', value: resolved.value }
    : { status: 'loading', value: null };
}

/** A successful HTTP response must still contain a readable contract identity. */
export function situationDocumentLabel(state: ReadState<unknown>): string {
  return state.status === 'loading' ? '读取中…' : (contextEntityTitle(state.value) ?? '无法读取');
}

/** A discovery title supplements only a successful exact read, never a denied resource. */
export function situationFocusLabel(
  state: ReadState<unknown>,
  rel: string,
  discovery: ReadState<unknown>,
): string {
  if (state.status !== 'ready') return situationDocumentLabel(state);
  const identity = contextEntityTitle(state.value);
  if (identity !== null) return identity;
  if (discovery.status === 'loading') return '读取中…';
  const surfaces = record(discovery.value)?.surfaces;
  const surface = Array.isArray(surfaces)
    ? surfaces.find((candidate) => record(candidate)?.rel === rel)
    : undefined;
  return text(record(surface)?.title) ?? '无法读取';
}

/** Thread switcher labels consume the same canonical collection projection. */
export function threadOptions(document: unknown): ContextReference[] {
  const entities = record(document)?.entities;
  if (!Array.isArray(entities)) return [];
  return entities.flatMap((entity: unknown) => {
    const rel = text(record(record(entity)?.properties)?.rel);
    const title = contextEntityTitle(entity);
    return rel?.startsWith('thread:') && title !== null ? [{ rel, title }] : [];
  });
}
