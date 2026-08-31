'use client';

import { useEffect, useState } from 'react';
import { parseCognitiveSemanticsDeclaration } from '@ui4a/shared';
import { redirectToLoginOnAuthError } from '@/components/auth-redirect';

export interface ApplicationEntry {
  name: string;
  title: string;
  intent: string;
}

/** Project valid business members from the authorized discovery document. */
export function applicationEntries(document: unknown): ApplicationEntry[] {
  if (
    typeof document !== 'object' ||
    document === null ||
    !('applications' in document) ||
    !Array.isArray(document.applications)
  ) {
    throw new Error('Invalid application discovery document');
  }
  return document.applications.flatMap((value: unknown) => {
    if (typeof value !== 'object' || value === null) return [];
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.name !== 'string' ||
      entry.name.trim() === '' ||
      typeof entry.title !== 'string' ||
      typeof entry.intent !== 'string'
    )
      return [];
    try {
      const presentation = parseCognitiveSemanticsDeclaration(entry.presentation);
      if (presentation?.traits?.includes('system-fallback')) return [];
    } catch {
      return [];
    }
    return [{ name: entry.name, title: entry.title, intent: entry.intent }];
  });
}

type CatalogState =
  { status: 'loading' | 'error' } | { status: 'ready'; entries: ApplicationEntry[] };

/** Shared full-authorized reader; attention never filters membership. */
export function useApplicationCatalog() {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetch('/.well-known/ui4a.json')
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          redirectToLoginOnAuthError(response.status, body);
          throw new Error(`Application discovery HTTP ${response.status}`);
        }
        return applicationEntries(body);
      })
      .then((entries) => {
        if (!cancelled) setState({ status: 'ready', entries });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return {
    state,
    retry: () => {
      setState({ status: 'loading' });
      setAttempt((current) => current + 1);
    },
  };
}
