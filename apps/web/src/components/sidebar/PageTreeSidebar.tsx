import { PageTreeSidebar as PagesTreeImpl } from "@feature/pages-frontend";
import { useCurrentUser } from "../../auth";
import { useSidebar } from "./SidebarContext";
import { sectionHasTree } from "./sectionFromPath";

export function PageTreeSidebar() {
  const { activeSection } = useSidebar();
  const me = useCurrentUser();
  if (!sectionHasTree(activeSection)) return null;
  return (
    <PagesTreeImpl
      key={activeSection}
      section={activeSection}
      currentUser={{ id: me.id, role: me.role }}
    />
  );
}
