import type { NativeFunctionHandler } from '../adapter';
import { enrichReferenceCve } from './cve-enrich';

export const nativeFunctionHandlerEntries: ReadonlyArray<{
  ref: string;
  handler: NativeFunctionHandler;
}> = [{ ref: 'security/cve-enrich@1', handler: enrichReferenceCve }];
