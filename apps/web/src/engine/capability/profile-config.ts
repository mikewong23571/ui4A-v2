import { parseNativeFunctionProfiles, type NativeFunctionProfileV1 } from '@ui4a/shared';
import { codingExecutorProfileRegistryFromEnvironment } from '../agent/coding-executor-config';

interface NativeFunctionEnvironment {
  readonly [key: string]: string | undefined;
  UI4A_NATIVE_FUNCTION_PROFILES?: string;
}

/** Parse the server-owned deployment registry; absence means no Function capability can activate. */
export function nativeFunctionProfilesFromEnvironment(
  environment: NativeFunctionEnvironment = process.env,
): NativeFunctionProfileV1[] {
  const raw = environment.UI4A_NATIVE_FUNCTION_PROFILES;
  if (raw === undefined) return [];
  return parseNativeFunctionProfiles(JSON.parse(raw) as unknown);
}

export function nativeFunctionProfileMapFromEnvironment(
  environment: NativeFunctionEnvironment = process.env,
): ReadonlyMap<string, NativeFunctionProfileV1> {
  return new Map(
    nativeFunctionProfilesFromEnvironment(environment).map((profile) => [profile.ref, profile]),
  );
}

export function nativeFunctionActivationRegistryFromEnvironment(
  environment: NativeFunctionEnvironment = process.env,
) {
  return new Map(
    nativeFunctionProfilesFromEnvironment(environment).map((profile) => [
      profile.ref,
      {
        executorClass: profile.executorClass,
        handlerRef: profile.handlerRef,
        available: profile.availability.status === 'available',
      },
    ]),
  );
}

export function nativeFunctionExecutorClassRegistryFromEnvironment(
  environment: NativeFunctionEnvironment = process.env,
): ReadonlyMap<string, string> {
  return new Map(
    nativeFunctionProfilesFromEnvironment(environment).map((profile) => [
      profile.ref,
      profile.executorClass,
    ]),
  );
}

export function capabilityExecutorClassRegistryFromEnvironment(): ReadonlyMap<string, string> {
  return new Map([
    ...codingExecutorProfileRegistryFromEnvironment(),
    ...nativeFunctionExecutorClassRegistryFromEnvironment(),
  ]);
}
