import { MyTasksPanel } from "@feature/vikunja-frontend";
import { useCurrentUser } from "../../auth";

export function MyTasksWidget() {
  const me = useCurrentUser();
  return <MyTasksPanel userId={me.id} />;
}
