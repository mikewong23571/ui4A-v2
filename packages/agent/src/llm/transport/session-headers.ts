/** Optional provider routing metadata; never supplies credentials or chooses a provider. */
export async function llmRoutingHeaders(
  sessionHeader: string | undefined,
  sessionId: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'user-agent': 'ui4a/0.1.0' };
  if (sessionHeader !== undefined) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId));
    headers[sessionHeader] = `ui4a-${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')}`;
  }
  return headers;
}
