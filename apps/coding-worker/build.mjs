// Bundles the coding worker plus every consumed-as-source workspace package into one runnable
// dist/worker.js, mirroring apps/api. Without this, tsc would emit only the shell and the @feature/*
// deps would stay as raw .ts that node cannot load.
import { build } from "esbuild";

const bundleWorkspaceOnly = {
  name: "bundle-workspace-only",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@feature/") || args.path.startsWith("@internal/")) return null;
      // p-limit (and its dep yocto-queue) are ESM-only; inline them so the CJS bundle has no ESM require.
      if (args.path === "p-limit" || args.path === "yocto-queue") return null;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  plugins: [bundleWorkspaceOnly],
});
