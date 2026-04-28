import { Container } from "@oddjob/ui";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border py-8 text-sm text-muted-foreground">
      <Container size="xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <img src="/icon-64.png" alt="" width={20} height={20} className="h-5 w-5" />
            <span>
              oddjob · <span className="font-mono text-xs">v0.0.0</span>
            </span>
          </p>
          <p className="font-mono text-xs">MIT · built for handling odd jobs</p>
        </div>
      </Container>
    </footer>
  );
}
