// Bundles the API plus every consumed-as-source workspace package into one runnable dist/server.js.
// Without this, tsc emits only the shell and the @feature/*-backend deps stay as raw .ts that node cannot load.
import { build } from "esbuild";

// Keeps third-party (node_modules) imports external while bundling workspace source (@feature/*, @internal/*).
const bundleWorkspaceOnly = {
  name: "bundle-workspace-only",
  setup(b) {
    // Matches bare specifiers (anything not starting with . or /), i.e. node builtins and node_modules.
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
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  plugins: [bundleWorkspaceOnly],
});
