import { getUser } from "./api.ts";

export async function handle(id: string): Promise<{ ok: true; user: string }> {
  const u = await getUser(id);
  return { ok: true, user: u.name };
}
