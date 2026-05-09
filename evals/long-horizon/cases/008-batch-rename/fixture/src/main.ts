import { handle } from "./handler.ts";
import { auditTrail } from "./audit.ts";
import { isAdmin } from "./admin.ts";
import { profileFor } from "./profile.ts";
import { cachedUser } from "./cache.ts";

export async function main(id: string): Promise<string> {
  const [h, a, ad, p, c] = await Promise.all([
    handle(id),
    auditTrail(id),
    isAdmin(id),
    profileFor(id),
    cachedUser(id),
  ]);
  return `${h.user}|${a}|${ad}|${p}|${c.id}`;
}
