import { Container, Heading, Section, buttonVariants } from "@oddjob/ui";

export function CtaStrip() {
  return (
    <Section spacing="default">
      <Container size="lg">
        <div className="rounded-xl border border-border bg-card p-10 sm:p-14 flex flex-col items-start gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
            ready when you are
          </p>
          <Heading as="h2" size="h2" className="text-balance">
            From <code className="font-mono text-primary">brew install</code> to scheduled agent in
            three commands.
          </Heading>
          <div className="flex flex-wrap gap-3">
            <a href="/docs" className={buttonVariants({ size: "lg" })}>
              Read the docs →
            </a>
            <a
              href="https://github.com/nineprimes/oddjob"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              View source
            </a>
          </div>
        </div>
      </Container>
    </Section>
  );
}
