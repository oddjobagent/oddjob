// BUG: doesn't handle multiple consecutive non-word characters; returns
// "hello---world" for "hello!!!world". Doesn't lowercase.
export function slugify(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "-");
}
