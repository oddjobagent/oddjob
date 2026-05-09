import { getModel } from "@mariozechner/pi-ai";
const m = getModel("openrouter" as never, "anthropic/claude-haiku-4.5" as never) as Record<
  string,
  unknown
>;
console.log("id:", m.id);
console.log("provider:", m.provider);
console.log("api:", m.api);
console.log("baseUrl:", m.baseUrl);
console.log("input cost/M:", (m.cost as Record<string, number>).input);
const id = m.id as string;
console.log("startsWith anthropic/:", id.startsWith("anthropic/"));
console.log("provider===openrouter:", m.provider === "openrouter");
