import { getUser, type User } from "./api.ts";

const memo = new Map<string, User>();
export async function cachedUser(id: string): Promise<User> {
  let u = memo.get(id);
  if (!u) {
    u = await getUser(id);
    memo.set(id, u);
  }
  return u;
}
