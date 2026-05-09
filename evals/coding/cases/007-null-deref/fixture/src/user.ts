// Returns the user's display name. Falls back to "anon" when no name is set.
//
// BUG: `user.profile` is typed as optional but the implementation calls
// `user.profile.name.trim()` without null-guarding. When `profile` is
// undefined (or `name` is undefined inside it), Bun throws
// "TypeError: undefined is not an object" at runtime.
//
// Minimal fix: optional-chain `user.profile?.name?.trim()` and fall back to
// "anon" on nullish.
export interface User {
  id: string;
  profile?: {
    name?: string;
    email?: string;
  };
}

export function displayName(user: User): string {
  const trimmed = user.profile.name.trim();
  return trimmed.length > 0 ? trimmed : "anon";
}
