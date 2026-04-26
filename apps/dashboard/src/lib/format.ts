export function formatCost(usd: number | undefined): string {
  if (usd === undefined || usd === null) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export function formatRelative(ts: number | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const past = diff > 0;
  const word = past ? "ago" : "from now";
  if (abs < 60_000) return `${Math.floor(abs / 1000)}s ${word}`;
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${word}`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${word}`;
  return `${Math.floor(abs / 86_400_000)}d ${word}`;
}

export function formatTokens(input: number, output: number): string {
  return `${input.toLocaleString()} / ${output.toLocaleString()}`;
}
