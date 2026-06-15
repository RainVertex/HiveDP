// GitHub repo reader used by devdocs sync to list/read Markdown and look up last commits.
import type { Octokit as OctokitClient } from "octokit";

// octokit v5 is ESM-only and this backend is CJS, so defer the import to avoid a load-time crash.
async function loadOctokit(): Promise<typeof OctokitClient> {
  const mod = await import("octokit");
  return mod.Octokit;
}

export interface RepoTarget {
  owner: string;
  repo: string;
  ref?: string;
  // Optional explicit token, otherwise the client is unauthenticated (public repos only).
  token?: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface CommitInfo {
  sha: string | null;
  date: Date | null;
  author: string | null;
}

export class RepoFetchClient {
  private octo: OctokitClient | null = null;
  private resolvedRef: string | null = null;

  constructor(
    private readonly target: RepoTarget,
    octo?: OctokitClient,
  ) {
    this.octo = octo ?? null;
  }

  private async getOcto(): Promise<OctokitClient> {
    if (this.octo) return this.octo;
    const Octokit = await loadOctokit();
    const token = this.target.token ?? undefined;
    this.octo = new Octokit(token ? { auth: token } : {});
    return this.octo;
  }

  async ref(): Promise<string> {
    if (this.resolvedRef) return this.resolvedRef;
    if (this.target.ref) {
      this.resolvedRef = this.target.ref;
      return this.resolvedRef;
    }
    const octo = await this.getOcto();
    const meta = await octo.rest.repos.get({
      owner: this.target.owner,
      repo: this.target.repo,
    });
    this.resolvedRef = meta.data.default_branch;
    return this.resolvedRef;
  }

  async exists(path: string): Promise<boolean> {
    const octo = await this.getOcto();
    const ref = await this.ref();
    try {
      await octo.rest.repos.getContent({
        owner: this.target.owner,
        repo: this.target.repo,
        path,
        ref,
      });
      return true;
    } catch (err) {
      if ((err as { status?: number }).status === 404) return false;
      throw err;
    }
  }

  async getFile(path: string): Promise<string | null> {
    const octo = await this.getOcto();
    const ref = await this.ref();
    try {
      const res = await octo.rest.repos.getContent({
        owner: this.target.owner,
        repo: this.target.repo,
        path,
        ref,
      });
      const data = res.data as { type?: string; encoding?: string; content?: string };
      if (data.type !== "file" || data.encoding !== "base64" || !data.content) return null;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  async listMarkdown(rootPath: string, maxFiles = 200): Promise<RepoFile[]> {
    const out: RepoFile[] = [];
    const queue: string[] = [rootPath];
    const octo = await this.getOcto();
    const ref = await this.ref();

    while (queue.length > 0 && out.length < maxFiles) {
      const dir = queue.shift()!;
      let entries: Array<{ type?: string; name?: string; path?: string }>;
      try {
        const res = await octo.rest.repos.getContent({
          owner: this.target.owner,
          repo: this.target.repo,
          path: dir,
          ref,
        });
        entries = Array.isArray(res.data) ? (res.data as typeof entries) : [];
      } catch (err) {
        if ((err as { status?: number }).status === 404) continue;
        throw err;
      }
      for (const entry of entries) {
        if (!entry.path || !entry.name) continue;
        if (entry.type === "dir") {
          queue.push(entry.path);
        } else if (entry.type === "file" && /\.mdx?$/i.test(entry.name)) {
          const content = await this.getFile(entry.path);
          if (content !== null) out.push({ path: entry.path, content });
          if (out.length >= maxFiles) break;
        }
      }
    }
    return out;
  }

  async lastCommitFor(path: string): Promise<CommitInfo> {
    const octo = await this.getOcto();
    const ref = await this.ref();
    try {
      const res = await octo.rest.repos.listCommits({
        owner: this.target.owner,
        repo: this.target.repo,
        path,
        sha: ref,
        per_page: 1,
      });
      const c = res.data[0];
      if (!c) return { sha: null, date: null, author: null };
      const dateStr = c.commit.author?.date ?? c.commit.committer?.date ?? null;
      const author = c.author?.login ?? c.commit.author?.name ?? c.commit.committer?.name ?? null;
      return {
        sha: c.sha ?? null,
        date: dateStr ? new Date(dateStr) : null,
        author,
      };
    } catch {
      return { sha: null, date: null, author: null };
    }
  }
}
