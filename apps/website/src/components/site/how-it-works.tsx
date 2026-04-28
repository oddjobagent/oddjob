import { Container, Heading, Section } from "@oddjob/ui";

interface Step {
  num: string;
  title: string;
  description: string;
  command: string;
}

const STEPS: Step[] = [
  {
    num: "01",
    title: "Write a blueprint",
    description:
      "TOML defines the model, prompt, tools, schemas, and triggers. Optional script sidecars and SKILL.md packs.",
    command: "$ oddjob init research --author you",
  },
  {
    num: "02",
    title: "Push and deploy",
    description:
      "Server validates, stores blueprint version, creates deployment with cron/webhook/manual triggers.",
    command: "$ oddjob deploy . --name research-prod",
  },
  {
    num: "03",
    title: "Run on schedule",
    description:
      "Daemon enqueues runs via cron or webhook. Outputs stream to console, Slack, email, or your webhook.",
    command: "$ oddjob run research-prod --input '...'",
  },
];

export function HowItWorks() {
  return (
    <Section className="bg-muted/30">
      <Container size="xl">
        <div className="mb-12 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
            how it works
          </p>
          <Heading as="h2" size="h2" className="text-balance">
            Three commands from blueprint to scheduled run.
          </Heading>
        </div>
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <li
              key={s.num}
              className="flex flex-col gap-4 rounded-lg border border-border bg-background p-6"
            >
              <span className="font-mono text-2xl text-primary">{s.num}</span>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              <pre className="mt-auto overflow-x-auto rounded border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">
                <code>{s.command}</code>
              </pre>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
