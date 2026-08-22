import { createWebPresentationBroker, type WebPresentationBroker } from './broker';
import { getDb, getEngine } from '../service';
import { RENDER_WORDS } from '../../render/registry';

const runtimeKey = Symbol.for('ui4a.presentation-broker');

interface PresentationGlobal {
  [runtimeKey]?: WebPresentationBroker;
}

/** Process adapter; the Broker store becomes durable/rebuildable in T16 Phase G. */
export function getPresentationBroker(): WebPresentationBroker {
  const scope = globalThis as typeof globalThis & PresentationGlobal;
  scope[runtimeKey] ??= createWebPresentationBroker({
    getEntity: async (rel) => (await getEngine(getDb())).getEntity(rel),
  });
  return scope[runtimeKey];
}

export function resetPresentationBrokerForTests(): void {
  const scope = globalThis as typeof globalThis & PresentationGlobal;
  delete scope[runtimeKey];
}

/** Thin live capability summary safe for Chat; schemas and the full catalog stay in Presentation. */
export function getPresentationCapabilities(): { markdownWord: boolean } {
  return { markdownWord: RENDER_WORDS.some((word) => word.name === 'markdown') };
}
