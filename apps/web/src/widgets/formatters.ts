// Breadcrumb path and relative-time formatting helpers for widgets.
function humanizeSegment(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPath(path: string, entityNames?: Map<string, string>): string {
  if (path === "/") return "Home";
  const segments = path.replace(/^\/|\/$/g, "").split("/");

  return segments
    .map((seg, i) => {
      // Swap the /catalog/:id cuid segment for the entity's real name.
      if (entityNames && i === 1 && segments[0] === "catalog") {
        const name = entityNames.get(seg);
        if (name) return name;
      }
      return humanizeSegment(seg);
    })
    .join("/");
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
