import { PageLayout, WidgetEditToolbar, WidgetGrid, useGridLayout } from "@internal/shared-ui";
import { useCurrentUser } from "../auth";
import { DEFAULT_WIDGETS, WIDGETS, HOME_WIDGET_LIST } from "../widgets";
import { HOME_LAYOUT_STORAGE_KEY } from "../widgets/types";

export function HomePage() {
  const user = useCurrentUser();
  const firstName = user.displayName.split(" ")[0] || user.displayName;
  const layout = useGridLayout({
    storageKey: HOME_LAYOUT_STORAGE_KEY,
    defaultWidgets: DEFAULT_WIDGETS,
    registry: WIDGETS,
  });

  return (
    <PageLayout
      title={`Welcome back, ${firstName}`}
      description="Your Vexana dashboard at a glance."
      actions={<WidgetEditToolbar layout={layout} availableWidgets={HOME_WIDGET_LIST} />}
    >
      <WidgetGrid
        widgets={layout.widgets}
        editMode={layout.editMode}
        registry={WIDGETS}
        onLayoutChange={layout.updateLayout}
        onRemove={layout.removeWidget}
        emptyState={{
          title: "No widgets on your home page",
          hint: 'Enter edit mode and click "Add widget" to get started.',
        }}
      />
    </PageLayout>
  );
}
