import { getUser } from "./api.ts";

export async function profileFor(id: string): Promise<string> {
  const u = await getUser(id);
  return `${u.name} (${u.id})`;
}
