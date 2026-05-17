import { Link } from "react-router-dom";
import { NotificationBell } from "@feature/notifications-frontend";
import { useCurrentUser } from "../auth";
import { ProfileAvatar } from "../profile";
import { ThemeSwitcher } from "../theme";

export function Header() {
  const user = useCurrentUser();

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-app-border bg-app-surface">
      <Link to="/" className="font-semibold text-app-text hover:text-app-primary transition-colors">
        Vexana
      </Link>

      <div className="flex items-center gap-3">
        <ThemeSwitcher variant="select" />
        <NotificationBell />

        <Link
          to="/settings"
          aria-label="Open settings"
          className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-app-border bg-app-surface hover:bg-app-surface-hover transition-colors"
        >
          <ProfileAvatar name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
          <span className="hidden sm:inline text-sm text-app-text">{user.displayName}</span>
        </Link>
      </div>
    </header>
  );
}
