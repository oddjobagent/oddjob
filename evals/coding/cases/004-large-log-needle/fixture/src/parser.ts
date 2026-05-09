// Parses a colon-separated config line into an object.
// BUG: split(":", 2) returns at most 2 elements [key, "v1"]; the value
// segment "v1:v2:v3" gets truncated to just "v1". Test expects the full
// remainder. Fix: split on first colon only via indexOf.

export function parseConfigLine(line: string): { key: string; value: string } {
  const parts = line.split(":", 2);
  return {
    key: parts[0] ?? "",
    value: parts[1] ?? "",
  };
}
