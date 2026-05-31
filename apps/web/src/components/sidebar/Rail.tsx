// Collapsible primary navigation rail with hover-peek overlay and a Requests badge.
import { useMemo, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useCurrentUser } from "../../auth";
import {
  AccountIcon,
  AdminIcon,
  BoardIcon,
  BotIcon,
  CubeIcon,
  HomeIcon,
  InboxIcon,
  ObservabilityIcon,
  PinIcon,
  PinOffIcon,
  PlugIcon,
  ScaffolderIcon,
  SparklesIcon,
  TeamsIcon,
} from "../../widgets/toolkit/icons";
import type { SidebarSection } from "./sectionFromPath";
import { useSidebar } from "./SidebarContext";
import { useRequestsSummary } from "./useRequestsSummary";

interface SectionDef {
  key: SidebarSection;
  to: string;
  label: string;
  icon: () => ReactNode;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { key: "home", to: "/", label: "Home", icon: HomeIcon },
  { key: "chat", to: "/chat", label: "Assistant", icon: BotIcon },
  { key: "catalog", to: "/catalog", label: "Catalog", icon: CubeIcon },
  { key: "selfservice", to: "/scaffolder", label: "Self-service", icon: ScaffolderIcon },
  { key: "requests", to: "/requests/team", label: "Requests", icon: InboxIcon },
  { key: "workspace", to: "/projects", label: "Projects", icon: BoardIcon },
  { key: "agents", to: "/agents", label: "Agents", icon: SparklesIcon },
  { key: "teams", to: "/teams", label: "Teams", icon: TeamsIcon },
  {
    key: "observability",
    to: "/observability",
    label: "Observability",
    icon: ObservabilityIcon,
  },
  {
    key: "integrations",
    to: "/integrations",
    label: "Integrations",
    icon: PlugIcon,
    adminOnly: true,
  },
  { key: "admin", to: "/admin/users", label: "Admin", icon: AdminIcon, adminOnly: true },
];

const FOOTER: Array<{ to: string; label: string; icon: () => ReactNode }> = [
  { to: "/settings", label: "Settings", icon: AccountIcon },
];

export function Rail() {
  const me = useCurrentUser();
  const { pinned, togglePinned, peeking, onRailMouseEnter, onRailMouseLeave } = useSidebar();
  const isAdmin = me.role === "admin";
  const summary = useRequestsSummary();
  const requestsBadge =
    summary !== null
      ? summary.myRequestsPending + (summary.canApprove ? summary.myApprovalsPending : 0)
      : 0;

  const sections = useMemo(() => SECTIONS.filter((s) => !s.adminOnly || isAdmin), [isAdmin]);

  return (
    <>
      <div
        onMouseEnter={onRailMouseEnter}
        onMouseLeave={onRailMouseLeave}
        className={`shrink-0 border-r border-app-border bg-app-surface transition-[width] duration-150 ${
          pinned ? "w-60" : "w-14"
        }`}
        aria-label="Primary navigation rail"
      >
        {/* Hidden when peeking so the overlay does not double-render rows. */}
        {(!peeking || pinned) && (
          <RailContent
            expanded={pinned}
            sections={sections}
            footer={FOOTER}
            pinned={pinned}
            onTogglePin={togglePinned}
            requestsBadge={requestsBadge}
          />
        )}
      </div>

      {/* Overlay must reuse the rail's enter/leave so peek survives crossing the visual boundary. */}
      {peeking && !pinned && (
        <div
          onMouseEnter={onRailMouseEnter}
          onMouseLeave={onRailMouseLeave}
          className="absolute left-0 top-0 z-40 h-full w-60 border-r border-app-border bg-app-surface shadow-xl"
        >
          <RailContent
            expanded={true}
            sections={sections}
            footer={FOOTER}
            pinned={pinned}
            onTogglePin={togglePinned}
            requestsBadge={requestsBadge}
          />
        </div>
      )}
    </>
  );
}

interface RailContentProps {
  expanded: boolean;
  sections: SectionDef[];
  footer: Array<{ to: string; label: string; icon: () => ReactNode }>;
  pinned: boolean;
  onTogglePin: () => void;
  requestsBadge: number;
}

function RailContent({
  expanded,
  sections,
  footer,
  pinned,
  onTogglePin,
  requestsBadge,
}: RailContentProps) {
  return (
    <nav className="flex h-full flex-col gap-1 p-2">
      <button
        type="button"
        onClick={onTogglePin}
        title={pinned ? "Unpin sidebar" : "Pin sidebar"}
        aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
        className="flex h-10 items-center gap-3 rounded-md px-2 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          {pinned ? <PinOffIcon /> : <PinIcon />}
        </span>
        {expanded && <span className="text-sm">{pinned ? "Unpin" : "Pin"}</span>}
      </button>

      <div className="my-1 border-t border-app-border" aria-hidden />

      {sections.map(({ key, to, label, icon: Icon }) => {
        const badge = key === "requests" && requestsBadge > 0 ? requestsBadge : 0;
        return (
          <NavLink
            key={key}
            to={to}
            end={to === "/"}
            title={badge > 0 ? `${label} (${badge} pending)` : label}
            className={({ isActive }) =>
              `relative flex h-10 items-center gap-3 rounded-md px-2 transition-colors ${
                isActive
                  ? "bg-app-primary-soft text-app-primary-soft-foreground font-medium"
                  : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
              }`
            }
          >
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
              <Icon />
              {badge > 0 && !expanded && (
                <span className="absolute -right-1.5 -top-1 rounded-full bg-app-primary px-1 text-[9px] font-semibold leading-tight text-app-primary-on">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
            {expanded && (
              <span className="flex flex-1 items-center justify-between gap-2 truncate text-sm">
                <span className="truncate">{label}</span>
                {badge > 0 && (
                  <span className="rounded-full bg-app-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-app-primary-on">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
            )}
          </NavLink>
        );
      })}

      <div className="mt-auto flex flex-col gap-1">
        <div className="my-1 border-t border-app-border" aria-hidden />
        {footer.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              `flex h-10 items-center gap-3 rounded-md px-2 transition-colors ${
                isActive
                  ? "bg-app-primary-soft text-app-primary-soft-foreground font-medium"
                  : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
              }`
            }
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
              <Icon />
            </span>
            {expanded && <span className="truncate text-sm">{label}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
