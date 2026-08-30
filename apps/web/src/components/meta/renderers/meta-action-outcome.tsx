import type { SirenEntity } from '@ui4a/engine';

import { redactMetaValue } from '../view-models/agent-definition';
import { genericDisclosureContract } from './generic-disclosure-contract';

interface OutcomeFact {
  key: string;
  title: string;
  value: unknown;
}

function boundedValue(value: unknown, depth = 0): unknown {
  const safe = redactMetaValue(value);
  if (typeof safe === 'string') return safe.length > 160 ? `${safe.slice(0, 157)}…` : safe;
  if (safe === null || typeof safe !== 'object') return safe;
  if (depth >= 2) return '[summary omitted]';
  if (Array.isArray(safe)) return safe.slice(0, 4).map((entry) => boundedValue(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(safe)
      .slice(0, 6)
      .map(([key, child]) => [key, boundedValue(child, depth + 1)]),
  );
}

function fallbackFacts(entity: SirenEntity): OutcomeFact[] {
  const entries = Object.entries(entity.properties).filter(([key]) => key !== 'presentation');
  const scalar = entries
    .filter(([, value]) => value === null || typeof value !== 'object')
    .slice(0, 4);
  const structured = entries
    .filter(([, value]) => value !== null && typeof value === 'object')
    .slice(-2);
  const selected = new Map([...scalar, ...structured]);
  return [...selected].map(([key, value]) => ({ key, title: key, value }));
}

function outcomeFacts(entity: SirenEntity): OutcomeFact[] {
  const disclosure = genericDisclosureContract(entity);
  if (disclosure.kind !== 'declared') return fallbackFacts(entity);
  return disclosure.fields.slice(0, 8).map(({ field, value }) => ({
    key: field.path,
    title: field.title,
    value,
  }));
}

/** Meta host projection for an executed action's returned, already-authorized Siren entity. */
export function MetaActionOutcome({ entity }: { entity: SirenEntity }) {
  const facts = outcomeFacts(entity);
  return (
    <section role="status" aria-label="执行结果" className="rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">已执行，当前合同结果</p>
      {facts.length > 0 && (
        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.key} className="min-w-0">
              <dt className="text-muted-foreground">{fact.title}</dt>
              <dd className="break-words">
                {typeof fact.value === 'object' && fact.value !== null
                  ? JSON.stringify(boundedValue(fact.value))
                  : String(boundedValue(fact.value) ?? '—')}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
