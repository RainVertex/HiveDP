// Renders a dashboard page (/p/:id) and its editable widget grid.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  PageLayout,
  WidgetEditToolbar,
  WidgetGrid,
  useRemoteGridLayout,
} from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { PageDto, PageWidgetInstance } from "@internal/shared-types";
import { useCurrentUser } from "../auth";
import { useSidebar } from "../components/sidebar/SidebarContext";
import {
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_LIST,
  type DashboardWidgetId,
} from "../widgets/dashboardRegistry";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; page: PageDto }
  | { kind: "error"; status: number };

export function DashboardPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const api = useApi();
  const me = useCurrentUser();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    setState({ kind: "loading" });
    api.pages
      .get(pageId)
      .then((page) => {
        if (!cancelled) setState({ kind: "loaded", page });
      })
      .catch((err: { status?: number } | Error) => {
        if (cancelled) return;
        const status = "status" in err && typeof err.status === "number" ? err.status : 500;
        setState({ kind: "error", status });
      });
    return () => {
      cancelled = true;
    };
  }, [api, pageId]);

  if (state.kind === "loading") {
    return (
      <PageLayout title="Loading…">
        <div className="text-sm text-app-text-muted">Loading dashboard…</div>
      </PageLayout>
    );
  }
  if (state.kind === "error") {
    return (
      <PageLayout title="Page not found">
        <div className="text-sm text-app-text-muted">
          This dashboard doesn&apos;t exist or you don&apos;t have access to it.
        </div>
      </PageLayout>
    );
  }

  return <DashboardView page={state.page} currentUserRole={me.role} currentUserId={me.id} />;
}

function DashboardView({
  page,
  currentUserId,
  currentUserRole,
}: {
  page: PageDto;
  currentUserId: string;
  currentUserRole: string;
}) {
  const api = useApi();
  const { setRouteSection } = useSidebar();

  // Without this, deep-links to /p/:id would land with the default tree (or none).
  useEffect(() => {
    setRouteSection(page.section);
    return () => setRouteSection(null);
  }, [page.section, setRouteSection]);

  const canEdit =
    page.scope === "SHARED" ? currentUserRole === "admin" : page.ownerUserId === currentUserId;

  // Stable reference required, else useRemoteGridLayout resets edit mode every render and Customize appears broken.
  const initialWidgets = useMemo(
    () =>
      (page.layout ?? []).filter((w) =>
        Boolean(DASHBOARD_WIDGETS[w.widgetId as DashboardWidgetId]),
      ) as Array<PageWidgetInstance & { widgetId: DashboardWidgetId }>,
    [page.layout],
  );

  const layout = useRemoteGridLayout<DashboardWidgetId>({
    initialWidgets,
    registry: DASHBOARD_WIDGETS,
    readOnly: !canEdit,
    onSave: async (widgets) => {
      await api.pages.updateLayout(page.id, widgets);
    },
  });

  return (
    <PageLayout
      title={page.title}
      description={
        page.scope === "SHARED" ? "Shared with everyone in the organization." : undefined
      }
      actions={
        canEdit ? (
          <WidgetEditToolbar layout={layout} availableWidgets={DASHBOARD_WIDGET_LIST} hideReset />
        ) : null
      }
    >
      <WidgetGrid
        widgets={layout.widgets}
        editMode={layout.editMode}
        registry={DASHBOARD_WIDGETS}
        onLayoutChange={layout.updateLayout}
        onRemove={layout.removeWidget}
        onConfigChange={layout.updateWidgetConfig}
        emptyState={{
          title: "Empty dashboard",
          hint: canEdit
            ? 'Click "Customize" then "Add widget" to fill this dashboard.'
            : "This dashboard has no widgets yet.",
        }}
      />
    </PageLayout>
  );
}
