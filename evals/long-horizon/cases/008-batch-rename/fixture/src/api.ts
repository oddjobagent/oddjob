export interface User {
  id: string;
  name: string;
}

export async function getUser(id: string): Promise<User> {
  return { id, name: `user-${id}` };
}
