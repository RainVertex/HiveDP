import type { RepoClient } from "./resolve";

// Repo read engine shared by the platform-source tools (the platform's own repo) and the project repo
// tools (a project's connected repo). Each function takes a resolved client and does the GitHub I/O, so
// the only difference between the two tool families is how the client is resolved.

const MAX_FILE_CHARS = 60_000;
const MAX_SEARCH_RESULTS = 25;

// Content search is a self-grep over the git tree, because GitHub's /search/code REST endpoint
// returns nothing for GitHub App installation tokens on private repos. We fetch each candidate
// blob and scan it, so it works with any credential.
const MAX_GREP_FILES = 300;
const MAX_BLOB_BYTES = 150_000;
const SNIPPETS_PER_FILE = 3;
const GREP_CONCURRENCY = 12;

const TEXT_EXT = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "mdx",
  "css",
  "scss",
  "html",
  "yml",
  "yaml",
  "prisma",
  "txt",
  "svg",
  "toml",
  "sh",
  "graphql",
  "gql",
  "vue",
]);
const EXCLUDE_PATH =
  /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|\.git|vendor)(\/|$)|\.(min\.(js|css)|map)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const SOURCE_DIR = /^(apps|features|packages|src)\//;

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i + 1).toLowerCase();
}

// Scan order, files whose path already hints at the query and files in the main source dirs go first
// so the MAX_GREP_FILES cap rarely hides a real match.
function priorityOf(b: { path: string }, tokens: string[]): number {
  const p = b.path.toLowerCase();
  let score = 0;
  if (tokens.some((t) => p.includes(t))) score += 2;
  if (SOURCE_DIR.test(b.path)) score += 1;
  return score;
}

// Strips GitHub search qualifier syntax so a stray "repo:"/"path:" cannot change scope or skew grep.
const SEARCH_QUALIFIER =
  /\b(?:repo|org|user|path|filename|extension|language|lang|fork|in|size|created|pushed|mirror|archived|is):\S*/gi;

function sanitizeSearchTerms(q: string): string {
  return q.replace(SEARCH_QUALIFIER, " ").replace(/\s+/g, " ").trim();
}

// Runs fn over items with a fixed concurrency, preserving input order in the result.
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function grepContent(content: string, tokens: string[]): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && hits.length < SNIPPETS_PER_FILE; i++) {
    const lower = lines[i].toLowerCase();
    if (tokens.some((t) => lower.includes(t))) {
      hits.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
    }
  }
  return hits;
}

export async function repoInfo(client: RepoClient) {
  const { octo, owner, repo, ref } = client;
  try {
    const meta = await octo.rest.repos.get({ owner, repo });
    let rootEntries: Array<{ name: string; type: string }> = [];
    try {
      const root = await octo.rest.repos.getContent({
        owner,
        repo,
        path: "",
        ...(ref ? { ref } : {}),
      });
      if (Array.isArray(root.data)) {
        rootEntries = root.data.map((e) => ({ name: e.name, type: e.type }));
      }
    } catch {
      // Root listing is best-effort, an empty repo or permission gap just yields no entries.
    }
    return {
      fullName: `${owner}/${repo}`,
      description: meta.data.description,
      defaultBranch: meta.data.default_branch,
      primaryLanguage: meta.data.language ?? null,
      topics: (meta.data as { topics?: string[] }).topics ?? [],
      archived: meta.data.archived,
      rootEntries,
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return {
        error: `Repository ${owner}/${repo} not found or not accessible`,
        code: "repo_not_found",
      };
    }
    return { error: (err as Error).message, code: "read_failed" };
  }
}

export async function repoSearch(client: RepoClient, query: string, signal?: AbortSignal) {
  if (typeof query !== "string" || !query.trim()) {
    return { error: "query required", code: "bad_args" };
  }
  const terms = sanitizeSearchTerms(query);
  if (!terms) {
    return {
      error: "query has no searchable terms after removing GitHub qualifiers",
      code: "bad_args",
    };
  }
  const tokens = terms.toLowerCase().split(/\s+/).filter(Boolean);
  const { octo, owner, repo, ref } = client;

  let blobs: Array<{ path: string; sha: string; size: number }>;
  let truncated: boolean;
  try {
    let branch = ref;
    if (!branch) {
      const meta = await octo.rest.repos.get({ owner, repo });
      branch = meta.data.default_branch;
    }
    const tree = await octo.rest.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: "true",
    });
    truncated = tree.data.truncated === true;
    blobs = (tree.data.tree ?? [])
      .filter((t) => t.type === "blob" && typeof t.path === "string" && typeof t.sha === "string")
      .map((t) => ({ path: t.path as string, sha: t.sha as string, size: t.size ?? 0 }));
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return {
        error: `Repository ${owner}/${repo} not found or not accessible`,
        code: "repo_not_found",
      };
    }
    return { error: (err as Error).message, code: "read_failed" };
  }

  type Hit = {
    path: string;
    via: "path" | "content";
    matches?: Array<{ line: number; text: string }>;
  };
  const results = new Map<string, Hit>();

  // Path/name matches, cheap and exact.
  for (const b of blobs) {
    if (tokens.some((tok) => b.path.toLowerCase().includes(tok))) {
      results.set(b.path, { path: b.path, via: "path" });
    }
  }

  // Content grep over a bounded, prioritized set of text files. Files whose path already matched
  // and files under the main source dirs are scanned first so the cap rarely hides a real hit.
  const eligible = blobs
    .filter(
      (b) =>
        !EXCLUDE_PATH.test(b.path) &&
        TEXT_EXT.has(extOf(b.path)) &&
        b.size > 0 &&
        b.size <= MAX_BLOB_BYTES,
    )
    .sort((a, b) => priorityOf(b, tokens) - priorityOf(a, tokens) || a.path.length - b.path.length);
  const candidates = eligible.slice(0, MAX_GREP_FILES);
  const scannedFiles = candidates.length;
  const grepBounded = eligible.length > MAX_GREP_FILES;

  await mapLimit(candidates, GREP_CONCURRENCY, async (b) => {
    if (signal?.aborted) return;
    try {
      const blob = await octo.rest.git.getBlob({ owner, repo, file_sha: b.sha });
      if (blob.data.encoding !== "base64") return;
      const content = Buffer.from(blob.data.content, "base64").toString("utf8");
      const matches = grepContent(content, tokens);
      if (matches.length > 0) {
        const existing = results.get(b.path);
        if (existing) existing.matches = matches;
        else results.set(b.path, { path: b.path, via: "content", matches });
      }
    } catch {
      // Skip unreadable blobs, a single bad file should not fail the whole search.
    }
  });

  const items = [...results.values()].slice(0, MAX_SEARCH_RESULTS);
  return {
    query: terms,
    total: items.length,
    items,
    scannedFiles,
    truncated: truncated || grepBounded,
  };
}

export async function repoListDir(client: RepoClient, path: string) {
  const { octo, owner, repo, ref } = client;
  try {
    const res = await octo.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) });
    if (!Array.isArray(res.data)) {
      return { error: "path is a file, use the read file tool", code: "is_file" };
    }
    return {
      path,
      entries: res.data.map((e) => ({ name: e.name, path: e.path, type: e.type })),
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { path, missing: true };
    return { error: (err as Error).message, code: "read_failed" };
  }
}

export async function repoReadFile(client: RepoClient, path: string) {
  if (typeof path !== "string" || !path) return { error: "path required", code: "bad_args" };
  const { octo, owner, repo, ref } = client;
  try {
    const res = await octo.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) });
    if (Array.isArray(res.data)) return { error: "path is a directory", code: "is_dir" };
    const data = res.data as { type?: string; encoding?: string; content?: string };
    if (data.type !== "file" || data.encoding !== "base64" || !data.content) {
      return { error: "not a readable text file", code: "unreadable" };
    }
    let content = Buffer.from(data.content, "base64").toString("utf8");
    const truncated = content.length > MAX_FILE_CHARS;
    if (truncated) content = content.slice(0, MAX_FILE_CHARS);
    return { path, content, truncated };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { path, missing: true };
    return { error: (err as Error).message, code: "read_failed" };
  }
}
