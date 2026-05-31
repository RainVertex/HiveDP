// DevDocs sidebar: builds a collapsible page tree with per-entity persisted expand state.
import { useEffect, useState } from "react";
import type { DocPageSummary } from "@internal/shared-types";

export interface DocsSidebarProps {
  entityId: string;
  pages: DocPageSummary[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}

function storageKey(entityId: string): string {
  return `devdocs:expanded:${entityId}`;
}

function loadExpanded(entityId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(entityId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((s): s is string => typeof s === "string"));
  } catch {
    return new Set();
  }
}

function saveExpanded(entityId: string, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(entityId), JSON.stringify(Array.from(set)));
  } catch {
    // localStorage can throw under quota or private mode, collapse state is best-effort.
  }
}

interface TreeNode {
  name: string;
  path: string;
  slug?: string;
  page?: DocPageSummary;
  children: TreeNode[];
}

function buildTree(pages: DocPageSummary[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const page of pages) {
    const segments = page.slug.split("/");
    let cursor = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const isLeaf = i === segments.length - 1;
      let child = cursor.children.find((c) => c.name === seg);
      if (!child) {
        const path = cursor.path ? `${cursor.path}/${seg}` : seg;
        child = { name: seg, path, children: [] };
        cursor.children.push(child);
      }
      if (isLeaf) {
        child.slug = page.slug;
        child.page = page;
      }
      cursor = child;
    }
  }
  sortNode(root);
  return root;
}

function sortNode(node: TreeNode): void {
  // Order: index first, then directories, then leaves alphabetical.
  node.children.sort((a, b) => {
    if (a.name === "index" && b.name !== "index") return -1;
    if (b.name === "index" && a.name !== "index") return 1;
    const aDir = a.children.length > 0;
    const bDir = b.children.length > 0;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortNode(c);
}

function freshnessDot(state: DocPageSummary["freshness"]) {
  switch (state) {
    case "fresh":
      return "bg-emerald-500";
    case "aging":
      return "bg-amber-500";
    case "stale":
      return "bg-red-500";
    default:
      return "bg-app-text-muted";
  }
}

function humanize(name: string): string {
  if (name === "index") return "Overview";
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ChevronGlyph({ open }: { open: boolean }) {
  // origin-center is required, SVG defaults to transform-origin 0 0 so rotate-90 would swing off-screen.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`shrink-0 origin-center transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path
        d="M3 1l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path
        d="M2 4.5A1.5 1.5 0 013.5 3h3l1.6 1.6H12.5A1.5 1.5 0 0114 6.1v6.4A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-8z"
        fill="currentColor"
        opacity="0.15"
      />
      <path
        d="M2 4.5A1.5 1.5 0 013.5 3h3l1.6 1.6H12.5A1.5 1.5 0 0114 6.1v6.4A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

interface RenderCtx {
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  expanded: Set<string>;
  toggle: (path: string) => void;
}

function PageRow({ node, ctx }: { node: TreeNode; ctx: RenderCtx }) {
  const isActive = node.slug === ctx.activeSlug;
  const label = node.page?.title || humanize(node.name);
  return (
    <button
      type="button"
      onClick={() => ctx.onSelect(node.slug!)}
      title={node.page?.title}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors ${
        isActive
          ? "bg-app-primary/10 text-app-text"
          : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${freshnessDot(
          node.page!.freshness,
        )}`}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function FolderRow({ node, ctx, open }: { node: TreeNode; ctx: RenderCtx; open: boolean }) {
  return (
    <button
      type="button"
      onClick={() => ctx.toggle(node.path)}
      aria-expanded={open}
      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-app-text hover:bg-app-surface-hover"
    >
      <span className="text-app-text-muted">
        <ChevronGlyph open={open} />
      </span>
      <span className="text-app-text-muted">
        <FolderGlyph />
      </span>
      <span className="truncate">{humanize(node.name)}</span>
    </button>
  );
}

function NodeItem({ node, ctx }: { node: TreeNode; ctx: RenderCtx }) {
  const isPage = !!node.slug;
  const isFolder = node.children.length > 0;

  if (isPage && !isFolder) {
    return (
      <li>
        <PageRow node={node} ctx={ctx} />
      </li>
    );
  }
  if (isFolder) {
    const open = ctx.expanded.has(node.path);
    return (
      <li>
        <FolderRow node={node} ctx={ctx} open={open} />
        {open && (
          <ul className="mt-0.5 ml-2 space-y-0.5 border-l border-app-border/60 pl-2">
            {isPage && (
              <li>
                <PageRow node={node} ctx={ctx} />
              </li>
            )}
            {node.children.map((c) => (
              <NodeItem key={c.path} node={c} ctx={ctx} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  return null;
}

export function DocsSidebar({ entityId, pages, activeSlug, onSelect }: DocsSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(entityId));

  // Reload per entity so each keeps its own collapse state.
  useEffect(() => {
    setExpanded(loadExpanded(entityId));
  }, [entityId]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpanded(entityId, next);
      return next;
    });
  };

  if (pages.length === 0) return null;
  const tree = buildTree(pages);
  const ctx: RenderCtx = { activeSlug, onSelect, expanded, toggle };

  return (
    <nav aria-label="DevDocs pages" className="text-sm">
      <ul className="space-y-0.5">
        {tree.children.map((c) => (
          <NodeItem key={c.path} node={c} ctx={ctx} />
        ))}
      </ul>
    </nav>
  );
}
