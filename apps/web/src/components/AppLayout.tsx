// App shell layout: header, sidebar rail, and a resizable Pages/main split.
import type { PropsWithChildren } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Header } from "./Header";
import { Rail } from "./sidebar/Rail";
import { PageTreeSidebar } from "./sidebar/PageTreeSidebar";
import { useSidebar } from "./sidebar/SidebarContext";
import { sectionHasTree } from "./sidebar/sectionFromPath";

export function AppLayout({ children }: PropsWithChildren) {
  const { activeSection } = useSidebar();
  const showPages = sectionHasTree(activeSection);

  // `v2` id suffix is intentional: it discards earlier broken pixel-numeric stored sizes.
  const persistedLayout = useDefaultLayout({
    id: "app-layout-pages-v2",
    panelIds: ["pages", "main"],
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-app-bg text-app-text">
      <Header />
      <div className="relative flex flex-1 min-h-0">
        <Rail />
        {showPages ? (
          <Group
            orientation="horizontal"
            id="app-layout-pages-v2"
            defaultLayout={persistedLayout.defaultLayout}
            onLayoutChanged={persistedLayout.onLayoutChanged}
            className="flex-1 min-h-0"
          >
            <Panel
              id="pages"
              defaultSize="18"
              minSize="12"
              maxSize="35"
              className="flex flex-col min-h-0"
            >
              <PageTreeSidebar />
            </Panel>
            <Separator className="w-px bg-app-border transition-colors hover:bg-app-primary data-[active=true]:bg-app-primary" />
            <Panel id="main" className="flex flex-col min-h-0">
              <main className="flex-1 overflow-auto">{children}</main>
            </Panel>
          </Group>
        ) : (
          <main className="flex-1 overflow-auto">{children}</main>
        )}
      </div>
    </div>
  );
}
