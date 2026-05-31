// Renders a unified diff (via the `diff` package's createPatch) with line-level coloring.
import { createPatch } from "diff";

interface DiffViewProps {
  path: string;
  before: string | null;
  after: string | null;
}

export function DiffView({ path, before, after }: DiffViewProps) {
  const patch = createPatch(path, before ?? "", after ?? "", "", "", { context: 3 });
  const lines = patch.split("\n");

  return (
    <pre className="overflow-x-auto rounded-md border border-app-border bg-app-surface-hover p-3 text-xs leading-tight">
      <code>
        {lines.map((line, i) => (
          <span key={i} className={lineClass(line)}>
            {line}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-app-text-muted";
  if (line.startsWith("@@")) return "text-app-primary";
  if (line.startsWith("+")) return "text-emerald-700";
  if (line.startsWith("-")) return "text-rose-700";
  return "text-app-text-muted";
}
