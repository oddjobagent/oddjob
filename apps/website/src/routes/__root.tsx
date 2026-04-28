/// <reference types="vite/client" />
import * as React from "react";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "~/styles.css?url";
import { SiteHeader } from "~/components/site/header.tsx";
import { SiteFooter } from "~/components/site/footer.tsx";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "Oddjob — Docker for AI agents" },
      {
        name: "description",
        content:
          "Task-specific AI agents defined as declarative TOML blueprints. Cron, webhook, or manual triggers. Single-binary deploy.",
      },
      { property: "og:title", content: "Oddjob" },
      { property: "og:description", content: "Docker for AI agents." },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  );
}
