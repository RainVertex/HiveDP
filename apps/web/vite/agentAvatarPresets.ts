// Build-time scan of public/agents/presets so dropping an SVG into that folder makes it a preset.
import { readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:agent-avatar-presets";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function toLabel(file: string): string {
  return file
    .replace(/\.svg$/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function readPresets(dir: string) {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".svg"));
  } catch {
    files = [];
  }
  files.sort();
  return files.map((file) => ({
    id: file.replace(/\.svg$/i, ""),
    label: toLabel(file),
    src: `/agents/presets/${file}`,
  }));
}

export function agentAvatarPresets(): Plugin {
  let dir = "";
  return {
    name: "agent-avatar-presets",
    configResolved(config) {
      dir = path.join(config.publicDir, "agents", "presets");
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) return `export default ${JSON.stringify(readPresets(dir))};`;
    },
    configureServer(server) {
      const isPreset = (p: string) => {
        const n = p.replace(/\\/g, "/");
        return n.includes("/agents/presets/") && n.toLowerCase().endsWith(".svg");
      };
      const reload = () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", (p) => isPreset(p) && reload());
      server.watcher.on("unlink", (p) => isPreset(p) && reload());
    },
  };
}
