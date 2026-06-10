#!/usr/bin/env node
// Dev-time feature scaffolder for this monorepo, separate from the self-service
// scaffolder, which only provisions external targets (Backstage-style).
//
// Usage: yarn create-feature <kebab-case-name>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const skeletonRoot = path.join(__dirname, "skeletons", "in-repo-feature");

const name = process.argv[2];
if (!name) {
  console.error("usage: yarn create-feature <kebab-case-name>");
  process.exit(1);
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  console.error(`invalid name "${name}" — must be kebab-case (e.g. my-feature)`);
  process.exit(1);
}

const targetDir = path.join(repoRoot, "features", name);
if (fs.existsSync(targetDir)) {
  console.error(`refusing to overwrite existing directory: ${targetDir}`);
  process.exit(1);
}

const transforms = {
  pascalCase: (s) =>
    s
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(""),
  camelCase: (s) => {
    const pc = transforms.pascalCase(s);
    return pc.charAt(0).toLowerCase() + pc.slice(1);
  },
  titleCase: (s) =>
    s
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" "),
};

function renderContent(text) {
  return text.replace(/\$\{\{\s*values\.name(?:\s*\|\s*(\w+))?\s*\}\}/g, (_, filter) =>
    filter ? transforms[filter](name) : name,
  );
}

function renderPath(p) {
  return p.replace(/__PASCAL__/g, transforms.pascalCase(name));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(skeletonRoot);
let written = 0;
for (const src of files) {
  const relRaw = path.relative(skeletonRoot, src);
  // Strip .tmpl extension and substitute __PASCAL__ in the path
  const rel = renderPath(relRaw.replace(/\.tmpl$/, ""));
  const dest = path.join(targetDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const content = fs.readFileSync(src, "utf8");
  fs.writeFileSync(dest, renderContent(content));
  written++;
}

console.log(`✓ created features/${name}/ (${written} files)`);
console.log("");
console.log("Next steps:");
console.log(`  1. yarn install                            # link the new workspaces`);
console.log(`  2. Add the feature to apps/api dependencies and wire its router in createServer.ts`);
console.log(`  3. Add the feature to apps/web dependencies, add a route in src/AppRoutes.tsx`);
console.log(`  4. Fill in features/${name}/AGENTS.md`);
console.log(
  `  5. yarn arch:check                          # verify boundaries, no cycles, declared deps`,
);
