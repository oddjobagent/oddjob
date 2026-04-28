import { Container, Section } from "@oddjob/ui";

const SAMPLE = `# blueprint.toml
namespace = "demo"
name = "research"
model = "anthropic/claude-sonnet-4"
tools = ["web_fetch", "web_search"]

prompt = """
Research the user's question and return a concise
3-paragraph answer with citations.
"""

[output_schema]
type = "object"
required = ["answer", "sources"]
[output_schema.properties.answer]
type = "string"
[output_schema.properties.sources]
type = "array"
items.type = "string"
`;

const COMMANDS = [
  "$ oddjob push jobs/research",
  "$ oddjob deploy jobs/research --name research-prod",
  "$ oddjob run research-prod --input 'why is the sky blue'",
];

export function CodeDemo() {
  return (
    <Section spacing="tight">
      <Container size="xl">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <figure className="rounded-lg border border-border bg-card overflow-hidden">
            <figcaption className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 font-mono text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary/60" aria-hidden />
              <span>blueprint.toml</span>
            </figcaption>
            <pre className="overflow-x-auto p-5 text-sm leading-relaxed">
              <code className="font-mono text-foreground">{SAMPLE}</code>
            </pre>
          </figure>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 font-mono text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary/60" aria-hidden />
              <span>terminal</span>
            </div>
            <pre className="overflow-x-auto p-5 text-sm leading-loose">
              <code className="font-mono text-muted-foreground">
                {COMMANDS.map((line, i) => (
                  <span key={i} className="block">
                    <span className="text-primary">{line.slice(0, 1)}</span>
                    {line.slice(1)}
                  </span>
                ))}
                <span className="block mt-3 text-foreground">status: complete</span>
                <span className="block text-muted-foreground/70">
                  ↳ structured output validated against schema
                </span>
              </code>
            </pre>
          </div>
        </div>
      </Container>
    </Section>
  );
}
