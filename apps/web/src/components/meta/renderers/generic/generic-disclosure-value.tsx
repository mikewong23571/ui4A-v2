import { redactMetaValue } from '../view-models/agent-definition';

const MAX_SHALLOW_ENTRIES = 8;
const MAX_VALUE_CHARACTERS = 240;

function boundedText(value: unknown): string {
  const text =
    value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
  return text.length > MAX_VALUE_CHARACTERS ? `${text.slice(0, MAX_VALUE_CHARACTERS - 1)}…` : text;
}

/** Redacted, bounded fact rendering shared by generic evidence and transient action receipts. */
export function DisclosureValue({ value }: { value: unknown }) {
  const safe = redactMetaValue(value);
  if (safe === null || typeof safe !== 'object') {
    return <span className="break-words">{boundedText(safe)}</span>;
  }
  if (Array.isArray(safe)) {
    return (
      <pre className="max-h-56 overflow-auto rounded bg-muted/50 p-2 text-xs">
        {boundedText(safe.slice(0, MAX_SHALLOW_ENTRIES))}
      </pre>
    );
  }
  const entries = Object.entries(safe).slice(0, MAX_SHALLOW_ENTRIES);
  return (
    <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
      {entries.map(([key, child]) => (
        <div key={key} className="contents">
          <dt className="font-medium text-muted-foreground">{key}</dt>
          <dd className="min-w-0 break-words">{boundedText(child)}</dd>
        </div>
      ))}
      {Object.keys(safe).length > entries.length && (
        <div className="contents">
          <dt className="font-medium text-muted-foreground">…</dt>
          <dd>{Object.keys(safe).length - entries.length} more</dd>
        </div>
      )}
    </dl>
  );
}
