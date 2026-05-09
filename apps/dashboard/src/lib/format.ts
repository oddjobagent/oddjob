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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Project-wide date format: "32 minutes ago" within the past hour, "4 hours ago"
 * within 24h, "28 Jan 26" otherwise. Future timestamps render as the absolute date.
 * Accepts epoch ms (number) or any Date.parse-able string.
 */
export function formatDate(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return "—";
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff >= 0 && diff < HOUR_MS) {
    const mins = Math.floor(diff / MINUTE_MS);
    if (mins <= 0) return "just now";
    if (mins === 1) return "1 minute ago";
    return `${mins} minutes ago`;
  }
  if (diff >= 0 && diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    if (hours === 1) return "1 hour ago";
    return `${hours} hours ago`;
  }
  const d = new Date(t);
  const day = d.getDate();
  const mon = MONTHS[d.getMonth()];
  const yr = String(d.getFullYear() % 100).padStart(2, "0");
  return `${day} ${mon} ${yr}`;
}

/** @deprecated use formatDate */
export const formatTimestamp = formatDate;
/** @deprecated use formatDate */
export const formatRelative = formatDate;

/**
 * Unabbreviated absolute representation for hover tooltips. e.g.
 * "28 Jan 2026, 14:32:18". Returns empty string for null/undefined so callers
 * can compose into `title` attributes without producing the literal "undefined".
 */
export function formatDateFull(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return "";
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const day = d.getDate();
  const mon = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day} ${mon} ${year}, ${hh}:${mm}:${ss}`;
}

/**
 * ISO 8601 string for `<time dateTime>` attributes. Empty string for null/undefined.
 */
export function formatDateIso(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined) return "";
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString();
}

export function formatTokens(input: number, output: number): string {
  return `${input.toLocaleString()} / ${output.toLocaleString()}`;
}
