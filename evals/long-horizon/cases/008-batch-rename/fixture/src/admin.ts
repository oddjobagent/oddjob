import { getUser } from "./api.ts";

export async function isAdmin(id: string): Promise<boolean> {
  const u = await getUser(id);
  return u.name.startsWith("admin");
}
