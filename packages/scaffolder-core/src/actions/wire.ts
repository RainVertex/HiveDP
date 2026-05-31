import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { stringHelpers } from "../plan-ctx";
import { makeUnifiedDiff } from "../diff";
import type { Mutation } from "../types";
import type { Action, ReadCtx, WriteCtx } from "./types";

// wire:* actions that idempotently splice a generated feature into apps/api and apps/web sources.

function detectEol(src: string): string {
  return src.includes("\r\n") ? "\r\n" : "\n";
}

function replaceBlock(src: string, oldBlock: string, newBlock: string, label: string): string {
  if (!src.includes(oldBlock)) {
    throw new Error(
      `wire action: could not locate the existing ${label} block. ` +
        "The target file may have drifted from the expected layout.",
    );
  }
  return src.replace(oldBlock, newBlock);
}

async function readRepoFile(repoRoot: string, relPath: string): Promise<string> {
  return await fs.readFile(join(repoRoot, relPath), "utf8");
}

async function writeRepoFile(repoRoot: string, relPath: string, content: string): Promise<void> {
  await fs.writeFile(join(repoRoot, relPath), content, "utf8");
}

interface WireResult {
  // Files to write, keyed by repo-relative path.
  files: Map<string, { before: string; after: string }>;
}

async function planWireFeature(repoRoot: string, name: string): Promise<WireResult> {
  const camel = stringHelpers.toCamel(name);
  const pascal = stringHelpers.toPascal(name);
  const out: WireResult = { files: new Map() };

  // createServer.ts: add the backend import and matching app.use line, both sorted.
  {
    const relPath = "apps/api/src/createServer.ts";
    const before = await readRepoFile(repoRoot, relPath);
    let src = before;
    const eol = detectEol(src);

    const importLine = `import { ${camel}Router } from "@feature/${name}-backend";`;
    const importRegex = /^import \{ \w+Router \} from "@feature\/[^"]+-backend";\r?$/gm;
    const imports = (src.match(importRegex) ?? []).map((s) => s.replace(/\r$/, ""));
    if (!imports.includes(importLine)) {
      const newImports = [...imports, importLine].sort();
      src = replaceBlock(
        src,
        imports.join(eol),
        newImports.join(eol),
        "@feature/*-backend imports",
      );
    }

    const useLine = `  app.use("/api/${name}", ${camel}Router);`;
    const useRegex = /^ {2}app\.use\("\/api\/[a-z][a-z0-9-]*", \w+Router\);\r?$/gm;
    const uses = (src.match(useRegex) ?? []).map((s) => s.replace(/\r$/, ""));
    if (!uses.includes(useLine)) {
      const newUses = [...uses, useLine].sort((a, b) => {
        const ap = a.match(/"\/api\/([^"]+)"/)![1]!;
        const bp = b.match(/"\/api\/([^"]+)"/)![1]!;
        return ap.localeCompare(bp);
      });
      src = replaceBlock(src, uses.join(eol), newUses.join(eol), "feature app.use");
    }
    if (src !== before) out.files.set(relPath, { before, after: src });
  }

  // AppRoutes.tsx: add the frontend import and matching <Route> element, sorted.
  {
    const relPath = "apps/web/src/AppRoutes.tsx";
    const before = await readRepoFile(repoRoot, relPath);
    let src = before;
    const eol = detectEol(src);

    const importLine = `import { ${pascal}Page } from "@feature/${name}-frontend";`;
    const importRegex = /^import \{ \w+Page \} from "@feature\/[^"]+-frontend";\r?$/gm;
    const imports = (src.match(importRegex) ?? []).map((s) => s.replace(/\r$/, ""));
    const newImports = imports.includes(importLine) ? imports : [...imports, importLine].sort();
    if (!imports.includes(importLine)) {
      src = replaceBlock(
        src,
        imports.join(eol),
        newImports.join(eol),
        "@feature/*-frontend imports",
      );
    }

    const featurePageNames = new Set(newImports.map((m) => m.match(/import \{ (\w+Page) \}/)![1]!));
    const routeLine = `      <Route path="/${name}" element={<${pascal}Page />} />`;
    const routeRegex = /^ {6}<Route path="\/[^"]+" element=\{<(\w+Page) \/>\} \/>\r?$/gm;
    const routes: string[] = [];
    for (const m of src.matchAll(routeRegex)) {
      if (featurePageNames.has(m[1]!)) routes.push(m[0].replace(/\r$/, ""));
    }
    if (!routes.includes(routeLine)) {
      const newRoutes = [...routes, routeLine].sort((a, b) => {
        const ap = a.match(/path="([^"]+)"/)![1]!;
        const bp = b.match(/path="([^"]+)"/)![1]!;
        return ap.localeCompare(bp);
      });
      src = replaceBlock(src, routes.join(eol), newRoutes.join(eol), "feature Route");
    }

    if (src !== before) out.files.set(relPath, { before, after: src });
  }

  // Add the workspace dep entries to apps/api and apps/web package.json.
  for (const target of [
    { relPath: "apps/api/package.json", dep: `@feature/${name}-backend` },
    { relPath: "apps/web/package.json", dep: `@feature/${name}-frontend` },
  ]) {
    const before = await readRepoFile(repoRoot, target.relPath);
    const pkg = JSON.parse(before) as { dependencies?: Record<string, string> };
    pkg.dependencies ??= {};
    if (!pkg.dependencies[target.dep]) {
      pkg.dependencies[target.dep] = "0.1.0";
      pkg.dependencies = Object.fromEntries(
        Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)),
      );
      const after = JSON.stringify(pkg, null, 2) + "\n";
      out.files.set(target.relPath, { before, after });
    }
  }

  return out;
}

const wireFeatureInput = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "feature name must be kebab-case starting with a letter"),
});

export const wireFeatureAction: Action<
  z.infer<typeof wireFeatureInput>,
  { changedFiles: string[] }
> = {
  id: "wire:feature",
  description: "Wire a generated feature into apps/api and apps/web.",
  schema: wireFeatureInput,
  capabilities: ["fs:write", "fs:write:main"],
  async match(input, ctx: ReadCtx) {
    const src = await ctx.readRepoFile("apps/api/src/createServer.ts");
    if (!src) return "absent";
    const camel = stringHelpers.toCamel(input.name);
    return src.includes(`from "@feature/${input.name}-backend"`)
      ? "match"
      : src.includes(`${camel}Router`)
        ? "drift"
        : "absent";
  },
  async diff(input, _ctx: ReadCtx) {
    // The real content diff lives in apply(); at plan time emit one placeholder mutation per file.
    const out: Mutation[] = [];
    for (const path of [
      "apps/api/src/createServer.ts",
      "apps/web/src/AppRoutes.tsx",
      "apps/api/package.json",
      "apps/web/package.json",
    ]) {
      out.push({
        kind: "fs.write",
        path,
        contentDiff: makeUnifiedDiff("(current)", `(wired @feature/${input.name}-*)`, path),
      });
    }
    return out;
  },
  async apply(input, ctx: WriteCtx) {
    const planned = await planWireFeature(ctx.repoRoot, input.name);
    if (planned.files.size === 0) {
      ctx.logger.info(`wire:feature: ${input.name} already wired; no-op`);
      return {
        output: { changedFiles: [] },
        compensation: { kind: "noop", reason: "already wired" },
      };
    }
    const changed: string[] = [];
    const previous: Array<{ path: string; previousContent: string | null }> = [];
    for (const [relPath, { before, after }] of planned.files) {
      previous.push({ path: relPath, previousContent: before });
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] wire:feature ${relPath}`);
      } else {
        await writeRepoFile(ctx.repoRoot, relPath, after);
        ctx.logger.info(`wire:feature ${relPath}`);
      }
      changed.push(relPath);
    }
    return {
      output: { changedFiles: changed },
      compensation: { kind: "repo.restore", files: previous },
    };
  },
};

const wireSidebarInput = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
});

export const wireSidebarAction: Action<
  z.infer<typeof wireSidebarInput>,
  { changedFiles: string[] }
> = {
  id: "wire:sidebar",
  description: "Add a sidebar navigation entry for a feature.",
  schema: wireSidebarInput,
  capabilities: ["fs:write", "fs:write:main"],
  async match(input, ctx: ReadCtx) {
    const src = await ctx.readRepoFile("apps/web/src/components/Sidebar.tsx");
    if (!src) return "absent";
    return src.includes(`{ to: "/${input.name}",`) ? "match" : "absent";
  },
  async diff(input, _ctx) {
    return [
      {
        kind: "fs.write",
        path: "apps/web/src/components/Sidebar.tsx",
        contentDiff: makeUnifiedDiff(
          "(current)",
          `(adds nav entry for /${input.name})`,
          "apps/web/src/components/Sidebar.tsx",
        ),
      },
    ];
  },
  async apply(input, ctx: WriteCtx) {
    const relPath = "apps/web/src/components/Sidebar.tsx";
    const before = await readRepoFile(ctx.repoRoot, relPath);
    const newEntry = `  { to: "/${input.name}", label: "${input.label}" },`;
    if (before.includes(newEntry)) {
      ctx.logger.info(`wire:sidebar: ${input.name} already in sidebar; no-op`);
      return {
        output: { changedFiles: [] },
        compensation: { kind: "noop", reason: "already wired" },
      };
    }
    // Anchor on the navItems array closing "];" to insert before it.
    const eol = detectEol(before);
    const closing = `\n];`;
    if (!before.includes(closing)) {
      throw new Error("wire:sidebar: could not locate navItems closing bracket in Sidebar.tsx");
    }
    const after = before.replace(closing, `${eol}${newEntry}${closing}`);

    if (ctx.dryRun) {
      ctx.logger.info(`[dry-run] wire:sidebar ${relPath}`);
    } else {
      await writeRepoFile(ctx.repoRoot, relPath, after);
      ctx.logger.info(`wire:sidebar ${relPath}`);
    }
    return {
      output: { changedFiles: [relPath] },
      compensation: {
        kind: "repo.restore",
        files: [{ path: relPath, previousContent: before }],
      },
    };
  },
};

export { wireFeatureInput, wireSidebarInput, planWireFeature };
