/** Reconstruct an external HTTPS origin only from edge-owned forwarding facts and an allowlist. */
export function resolveTrustedRequestOrigin(
  request: Request,
  trustedOrigins: readonly string[],
): string | undefined {
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host') ?? requestUrl.host;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProto ?? requestUrl.protocol.replace(/:$/, '');
  if (host.includes(',') || protocol.includes(',') || protocol !== 'https') return undefined;

  let origin: string;
  try {
    origin = new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
  return trustedOrigins.includes(origin) ? origin : undefined;
}
