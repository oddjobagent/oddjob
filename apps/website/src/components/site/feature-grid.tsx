import { Container, Heading, Section } from "@oddjob/ui";

interface Feature {
  num: string;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    num: "01",
    title: "Declarative TOML",
    description:
      "Whole agent — model, prompt, tools, connectors, schemas — in a single file. No code, no scaffolding.",
  },
  {
    num: "02",
    title: "Cron + webhook triggers",
    description:
      "Run on a schedule (croner under the hood), via HMAC-signed webhook, or manually from the CLI.",
  },
  {
    num: "03",
    title: "12 built-in tools",
    description:
      "bash, read/write/edit, grep, find, web_fetch, web_search, javascript, python, datetime — opt-in per blueprint.",
  },
  {
    num: "04",
    title: "MCP connectors",
    description:
      "stdio, Streamable HTTP, and SSE. OAuth lifecycle handled. Same shape Claude Code uses.",
  },
  {
    num: "05",
    title: "Multi-channel output",
    description:
      "Console, Slack, email (Resend), generic webhook — declared in deploy.toml, structured-output aware.",
  },
  {
    num: "06",
    title: "Single-binary deploy",
    description:
      "bun build --compile produces one ~65 MB binary. Server, dashboard, scheduler, queue — all in.",
  },
];

export function FeatureGrid() {
  return (
    <Section>
      <Container size="xl">
        <div className="mb-12 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
            features
          </p>
          <Heading as="h2" size="h2" className="text-balance">
            One process. One binary. Every tool you'd reach for.
          </Heading>
        </div>
        <div className="grid gap-px bg-border rounded-lg overflow-hidden border border-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.num} className="bg-background p-6 sm:p-8 flex flex-col gap-3">
              <span className="font-mono text-xs text-primary">{f.num}</span>
              <h3 className="text-lg font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}
