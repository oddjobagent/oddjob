import { Container, Heading, Section, buttonVariants } from "@oddjob/ui";

export function Hero() {
  return (
    <Section spacing="loose" className="relative overflow-hidden">
      <Container size="xl">
        <div className="max-w-4xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-6">
            <span className="text-primary">▸</span> v0.0.0 · pre-alpha
          </p>
          <Heading as="h1" size="h1" className="text-balance">
            Docker for <span className="text-primary">AI agents</span>.
          </Heading>
          <p className="mt-6 max-w-2xl text-lg sm:text-xl text-muted-foreground leading-relaxed text-balance">
            Single-purpose AI agents defined as declarative TOML blueprints. Run on cron, webhook,
            or manual trigger from a single binary.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href="/docs" className={buttonVariants({ size: "lg" })}>
              Get started →
            </a>
            <a
              href="https://github.com/nineprimes/oddjob"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              ★ on GitHub
            </a>
          </div>
          <div className="mt-12 flex items-center gap-3 font-mono text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden />
            <span>declarative · single-binary · self-host</span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
        </div>
      </Container>
    </Section>
  );
}
