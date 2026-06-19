#!/usr/bin/env node
// Two checks dependency-cruiser cannot do natively, run as one architecture gate.
// 1. Declared-dependency integrity: every @feature/* or @internal/* a package imports must be in its package.json deps.
//    Catches "phantom coupling" where the dependency graph in package.json understates the real coupling.
// 2. Fan-in budget: a feature package too many sibling features (same layer) depend on becomes a cross-team bottleneck.
//    Checked per layer (backend, frontend) so the next inbound edge is a conscious decision, not an accident.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
// Fan-in budget per layer: flag a feature too many sibling features depend on, before it becomes a bottleneck.
const FANIN_LAYERS = [
  { suffix: "-backend", budget: 6 },
  { suffix: "-frontend", budget: 6 },
];

// Collects every workspace package.json under the given roots.
function findPackages() {
  const roots = ["apps", "packages"];
  for (const f of readdirSync(join(repoRoot, "features"))) roots.push(join("features", f));
  const pkgs = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = join(abs, name);
      if (!safeIsDir(dir)) continue;
      const pkgPath = join(dir, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name) pkgs.push({ name: pkg.name, dir, pkg });
      } catch {
        // not a package dir, skip
      }
    }
  }
  return pkgs;
}

function safeIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Walks a package src tree and returns the set of workspace package names it imports.
function importedWorkspaceDeps(dir) {
  const found = new Set();
  const srcDir = join(dir, "src");
  if (!safeIsDir(srcDir)) return found;
  const importRe = /(?:from\s+|import\s+|require\(\s*)["']((?:@feature|@internal)\/[^"']+)["']/g;
  const stack = [srcDir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        let m;
        while ((m = importRe.exec(text))) {
          const parts = m[1].split("/");
          found.add(`${parts[0]}/${parts[1]}`);
        }
      }
    }
  }
  return found;
}

const pkgs = findPackages();
const names = new Set(pkgs.map((p) => p.name));
const undeclared = [];

for (const { name, dir, pkg } of pkgs) {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  for (const imported of importedWorkspaceDeps(dir)) {
    if (!names.has(imported)) continue;
    if (imported === name) continue;
    if (!declared.has(imported)) {
      undeclared.push({ from: name, to: imported, dir: relative(repoRoot, dir) });
    }
  }
}

// Fan-in over declared same-layer feature edges, one pass per layer.
const overBudget = [];
for (const { suffix, budget } of FANIN_LAYERS) {
  const fanIn = new Map();
  const depRe = new RegExp(`^@feature/.*${suffix}$`);
  for (const { pkg } of pkgs) {
    if (!pkg.name.endsWith(suffix)) continue;
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (depRe.test(dep)) fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
    }
  }
  const sorted = [...fanIn.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length) {
    console.log(`Feature ${suffix.slice(1)} fan-in (inbound feature deps):`);
    for (const [dep, n] of sorted) console.log(`  ${n}  ${dep}`);
    console.log(`  budget: ${budget}`);
  }
  for (const [dep, n] of fanIn) if (n > budget) overBudget.push({ dep, n, budget });
}

let failed = false;
if (undeclared.length) {
  failed = true;
  console.error("\nUndeclared workspace imports (import exists but not in package.json deps):");
  for (const u of undeclared)
    console.error(`  ${u.from}  imports  ${u.to}  (declare it in ${u.dir}/package.json)`);
}
if (overBudget.length) {
  failed = true;
  console.error("\nFan-in budget exceeded:");
  for (const { dep, n, budget } of overBudget)
    console.error(
      `  ${dep} has ${n} inbound feature deps (budget ${budget}). Consider a narrow contract barrel or splitting it.`,
    );
}

if (failed) {
  console.error("\nArchitecture dependency check failed.");
  process.exit(1);
}
console.log("\nArchitecture dependency check passed.");
