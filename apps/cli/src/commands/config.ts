import { spawn } from "node:child_process";

import { defineCommand } from "citty";

import { api } from "../lib/api.ts";
import { CONFIG_PATH } from "../lib/config.ts";

export default defineCommand({
  meta: { name: "config", description: "Show / reload / edit ~/.oddjob/config.toml." },
  args: {
    action: { type: "positional", required: true, description: "show | reload | edit | path" },
  },
  async run({ args }) {
    switch (args.action) {
      case "path": {
        process.stdout.write(`${CONFIG_PATH}\n`);
        break;
      }
      case "show": {
        const r = await api.config.get();
        process.stdout.write(`config: ${CONFIG_PATH}\n\n`);
        process.stdout.write("plugins:\n");
        for (const p of r.plugins) {
          const flag = p.enabled ? "y" : "-";
          process.stdout.write(
            `  ${flag} ${p.slug.padEnd(20)} ${p.version.padEnd(10)} ${p.source}\n`,
          );
        }
        process.stdout.write("\nproviders:\n");
        for (const c of r.providers) {
          const tag = c.source === "config" ? "[toml]" : "[dash]";
          process.stdout.write(
            `  ${tag} ${c.providerSlug}/${c.credentialName.padEnd(12)} ${c.apiKeySecret ?? "(no key)"}\n`,
          );
        }
        process.stdout.write("\nroles:\n");
        for (const a of r.roles) {
          const tag = a.source === "config" ? "[toml]" : "[dash]";
          process.stdout.write(
            `  ${tag} ${a.role.padEnd(12)} ${a.providerSlug}/${a.modelId}  [${a.credentialName}]\n`,
          );
        }
        break;
      }
      case "reload": {
        await api.config.reload();
        process.stdout.write(`reloaded ${CONFIG_PATH}\n`);
        break;
      }
      case "edit": {
        const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vim";
        await new Promise<void>((resolve, reject) => {
          const child = spawn(editor, [CONFIG_PATH], { stdio: "inherit" });
          child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${editor} exited with code ${code}`));
          });
          child.on("error", reject);
        });
        await api.config.reload();
        process.stdout.write(`reloaded after edit\n`);
        break;
      }
      default:
        process.stderr.write(`unknown action: ${args.action}\n`);
        process.exitCode = 1;
        return;
    }
  },
});
