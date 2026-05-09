import { getUser } from "./api.ts";

export async function auditTrail(id: string): Promise<string> {
  const u = await getUser(id);
  return `audit:${u.id}:${u.name}`;
}
