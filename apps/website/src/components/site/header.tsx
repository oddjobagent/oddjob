import { Link } from "@tanstack/react-router";
import { Container } from "@oddjob/ui";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <Container size="xl">
        <div className="flex h-14 items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
          >
            <img src="/icon-64.png" alt="" width={28} height={28} className="h-7 w-7" />
            <span>oddjob</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a
              href="/docs"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              docs
            </a>
            <a
              href="https://github.com/nineprimes/oddjob"
              className="text-muted-foreground hover:text-foreground transition-colors"
              target="_blank"
              rel="noreferrer"
            >
              github
            </a>
          </nav>
        </div>
      </Container>
    </header>
  );
}
