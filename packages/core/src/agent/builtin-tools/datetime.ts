import type { Static } from "typebox";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const schema = Type.Object({
  timezone: Type.Optional(
    Type.String({
      description: "IANA timezone (e.g. 'America/Los_Angeles', 'UTC'). Default: UTC.",
    }),
  ),
  format: Type.Optional(
    Type.Union(
      [Type.Literal("iso"), Type.Literal("rfc2822"), Type.Literal("unix"), Type.Literal("human")],
      { description: "Output format. Default: iso (ISO 8601)." },
    ),
  ),
});
type Input = Static<typeof schema>;

interface Details {
  iso: string;
  unix: number;
  timezone: string;
}

export interface DatetimeToolOptions {
  /** Override clock for tests. Returns a Date. */
  now?: () => Date;
}

export function createDatetimeTool(opts: DatetimeToolOptions = {}): AgentTool<typeof schema> {
  const clock = opts.now ?? (() => new Date());
  return {
    name: "datetime",
    label: "Current Date/Time",
    description:
      "Return the current date and time. Optional timezone (IANA) and format (iso | rfc2822 | unix | human).",
    parameters: schema,
    async execute(_id, params: Input): Promise<AgentToolResult<Details>> {
      const now = clock();
      const tz = params.timezone ?? "UTC";
      const format = params.format ?? "iso";
      const iso = now.toISOString();
      const unix = Math.floor(now.getTime() / 1000);

      let text: string;
      try {
        switch (format) {
          case "unix":
            text = String(unix);
            break;
          case "rfc2822":
            text = now.toUTCString();
            break;
          case "human":
            text = new Intl.DateTimeFormat("en-US", {
              timeZone: tz,
              dateStyle: "full",
              timeStyle: "long",
            }).format(now);
            break;
          case "iso":
          default:
            text =
              tz === "UTC"
                ? iso
                : new Intl.DateTimeFormat("sv-SE", {
                    timeZone: tz,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })
                    .format(now)
                    .replace(" ", "T") + ` (${tz})`;
            break;
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `datetime error: invalid timezone '${tz}' (${(err as Error).message})`,
            },
          ],
          details: { iso, unix, timezone: "UTC" },
        };
      }

      return {
        content: [{ type: "text", text }],
        details: { iso, unix, timezone: tz },
      };
    },
  };
}
