import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const maximumTokenBytes = 4096;

function fail(): never {
  throw new Error('UI4A_CALLBACK_TOKEN_FILE_INVALID');
}

/** Load the Compose callback credential without changing local/Kubernetes direct-env behavior. */
export function loadCapabilityCallbackToken(environment: NodeJS.ProcessEnv = process.env): void {
  const direct = environment.UI4A_CAPABILITY_CALLBACK_TOKEN;
  const path = environment.UI4A_CAPABILITY_CALLBACK_TOKEN_FILE;
  if (direct !== undefined && path !== undefined) fail();
  if (path === undefined) return;
  if (!isAbsolute(path) || path.includes('\0')) fail();
  let facts;
  let value: string;
  try {
    facts = lstatSync(path);
    if (
      !facts.isFile() ||
      facts.isSymbolicLink() ||
      facts.size < 1 ||
      facts.size > maximumTokenBytes
    ) {
      fail();
    }
    value = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message === 'UI4A_CALLBACK_TOKEN_FILE_INVALID') throw error;
    fail();
  }
  if (
    value === '' ||
    value.length > maximumTokenBytes ||
    value.trim() !== value ||
    value.includes('\0')
  ) {
    fail();
  }
  environment.UI4A_CAPABILITY_CALLBACK_TOKEN = value;
}
