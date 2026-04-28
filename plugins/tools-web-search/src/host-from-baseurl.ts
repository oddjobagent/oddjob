// Helper used by every search provider's `resolveHost` impl.
//
// Returns the hostname the provider will contact for the given credential.
// Matches the same `cred.options.baseUrl` → fallback fallback path the
// `search()` impl uses, so the env-egress gate sees the EXACT host the
// upstream call will fire at.

export function hostFromBaseUrl(
  rawBaseUrl: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const candidate = rawBaseUrl ?? fallback;
  if (!candidate) return undefined;
  try {
    return new URL(candidate).hostname;
  } catch {
    return undefined;
  }
}
