// @oddjob/plugin-web-fetch-core — bundles 4 web-fetch backends.

import { definePlugin } from "@oddjob/sdk";

import { browserbaseFetch } from "./browserbase.ts";
import { firecrawlFetch } from "./firecrawl.ts";
import { rawFetch } from "./raw.ts";
import { scrapingbeeFetch } from "./scrapingbee.ts";

export default definePlugin(
  {
    slug: "web-fetch-core",
    name: "Web Fetch Backends",
    description:
      "Bundled web-fetch backends: raw (Bun-native), Browserbase, Firecrawl, ScrapingBee.",
    version: "0.1.0",
    author: "Oddjob",
  },
  (b) => {
    b.webFetch({
      id: "raw",
      displayName: "Raw (Bun-native)",
      authHint: "No API key. Bun's fetch with manual redirect + HTML→markdown.",
      fetch: rawFetch,
      // Raw follows redirects in-process and re-runs the dispatcher's
      // validateUrl callback for every Location target.
      supportsRedirectValidation: true,
    });
    b.webFetch({
      id: "browserbase",
      displayName: "Browserbase",
      authHint: "BROWSERBASE_API_KEY. Managed Chromium with proxy + captcha solving.",
      fetch: browserbaseFetch,
      // Managed scraper follows redirects server-side; we cannot enforce a
      // per-hop gate. Dispatcher refuses this backend in limited-networking
      // envs and post-validates the final URL otherwise.
      supportsRedirectValidation: false,
    });
    b.webFetch({
      id: "firecrawl",
      displayName: "Firecrawl",
      authHint: "FIRECRAWL_API_KEY. JS-rendered scrape with clean markdown extraction.",
      fetch: firecrawlFetch,
      supportsRedirectValidation: false,
    });
    b.webFetch({
      id: "scrapingbee",
      displayName: "ScrapingBee",
      authHint: "SCRAPINGBEE_API_KEY. Proxy + JS render via GET.",
      fetch: scrapingbeeFetch,
      supportsRedirectValidation: false,
    });
  },
);
