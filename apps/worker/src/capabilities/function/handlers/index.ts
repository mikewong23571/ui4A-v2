import type { NativeFunctionHandler } from '../adapter';
import { enrichReferenceCve } from './cve-enrich';
import { normalizeReferenceText } from './text-normalize';

export const nativeFunctionHandlerEntries: ReadonlyArray<{
  ref: string;
  handler: NativeFunctionHandler;
}> = [
  { ref: 'security/cve-enrich@1', handler: enrichReferenceCve },
  { ref: 'reference/text-normalize@1', handler: normalizeReferenceText },
];
