import { Link } from "react-router-dom";
import { NotificationBell } from "@feature/notifications-frontend";
import { useTranslation } from "@internal/i18n";
import { useCurrentUser } from "../auth";
import { ProfileAvatar } from "../profile";
import { ThemeSwitcher } from "../theme";
import { BrandLogo } from "./Brand";

export function Header() {
  const user = useCurrentUser();
  const { t } = useTranslation();

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-app-border bg-app-surface">
      <Link to="/" aria-label="HiveDP" className="transition-opacity hover:opacity-80">
        <BrandLogo />
      </Link>

      <div className="flex items-center gap-3">
        <ThemeSwitcher variant="select" />
        <NotificationBell />

        <Link
          to="/settings"
          aria-label={t("header.openSettings")}
          className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-app-border bg-app-surface hover:bg-app-surface-hover transition-colors"
        >
          <ProfileAvatar name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
          <span className="hidden sm:inline text-sm text-app-text">{user.displayName}</span>
        </Link>
      </div>
    </header>
  );
}
