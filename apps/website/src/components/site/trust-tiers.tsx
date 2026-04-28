import { Container, Heading, Section } from "@oddjob/ui";

interface Tier {
  name: string;
  provider: string;
  use: string;
}

const TIERS: Tier[] = [
  {
    name: "trusted",
    provider: "process",
    use: "dev only · same uid as the daemon",
  },
  {
    name: "local-strict",
    provider: "seatbelt / bwrap",
    use: "default · OS-level fs scoping",
  },
  {
    name: "container",
    provider: "docker",
    use: "self-host with Docker available",
  },
  {
    name: "remote-vm",
    provider: "daytona",
    use: "hosted, untrusted blueprints",
  },
];

export function TrustTiers() {
  return (
    <Section spacing="tight">
      <Container size="xl">
        <div className="mb-8 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
            isolation
          </p>
          <Heading as="h2" size="h3" className="text-balance">
            Pick your trust tier per environment.
          </Heading>
        </div>
        <div className="grid gap-px bg-border rounded-lg overflow-hidden border border-border sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => (
            <div key={t.name} className="bg-background p-5 flex flex-col gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-primary">
                {t.name}
              </span>
              <p className="text-sm font-mono text-foreground">{t.provider}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{t.use}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
