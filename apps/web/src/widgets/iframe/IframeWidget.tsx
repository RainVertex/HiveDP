// Dashboard widget that embeds an https:// page in a sandboxed iframe.
import type { WidgetComponentProps } from "@internal/shared-ui";

export function IframeWidget({ config }: WidgetComponentProps) {
  const url = typeof config?.url === "string" ? config.url : "";
  if (!url || !url.startsWith("https://")) {
    return (
      <div className="text-sm text-app-text-muted">
        No URL set. Click the gear icon in edit mode to embed an https:// page.
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title="Embedded content"
      className="h-full w-full rounded border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      loading="lazy"
    />
  );
}
