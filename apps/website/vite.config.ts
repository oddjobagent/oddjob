import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import mdx from "@mdx-js/rollup";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import remarkGfm from "remark-gfm";
import rehypePrettyCode from "rehype-pretty-code";
import path from "node:path";

export default defineConfig({
  server: {
    port: 7701,
  },
  resolve: {
    alias: {
      "@docs": path.resolve(import.meta.dirname, "../../docs"),
    },
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    {
      enforce: "pre",
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [
          remarkGfm,
          remarkFrontmatter,
          [remarkMdxFrontmatter, { name: "frontmatter" }],
        ],
        rehypePlugins: [
          [
            rehypePrettyCode,
            {
              theme: { dark: "github-dark", light: "github-light" },
              keepBackground: false,
            },
          ],
        ],
      }),
    },
    tanstackStart({ srcDirectory: "src" }),
    viteReact({ include: /\.(jsx|tsx|mdx?)$/ }),
    // Preset is driven by NITRO_PRESET env var; defaults to node-server in dev,
    // set to cloudflare-module by `bun run build:cloudflare` for deploy.
    nitro(),
  ],
});
