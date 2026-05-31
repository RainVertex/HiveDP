// Renders a single Grafana panel PNG via the backend proxy (keeps the SA token server-side).

import { useApi } from "@internal/api-client/react";

export interface GrafanaDashboardEmbedProps {
  dashboardUid: string;
  panelId: number;
  from?: string;
  to?: string;
  width?: number;
  height?: number;
  title?: string;
  // Required for non-admin callers, the backend gates rendering on team membership of an owning entity.
  entityId?: string;
}

export function GrafanaDashboardEmbed({
  dashboardUid,
  panelId,
  from,
  to,
  width = 800,
  height = 400,
  title,
  entityId,
}: GrafanaDashboardEmbedProps) {
  const api = useApi();
  const src = api.observability.dashboardImageUrl({
    dashboardUid,
    panelId,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    w: width,
    h: height,
    ...(entityId ? { entityId } : {}),
  });
  return (
    <figure className="overflow-hidden rounded border border-app-border bg-app-bg">
      <img
        src={src}
        alt={title ?? `Grafana panel ${dashboardUid}/${panelId}`}
        width={width}
        height={height}
        loading="lazy"
        className="block w-full"
      />
      {title && <figcaption className="px-2 py-1 text-xs text-app-text-muted">{title}</figcaption>}
    </figure>
  );
}
