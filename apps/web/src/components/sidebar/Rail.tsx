// Collapsible primary navigation rail with hover-peek overlay.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { NavLink, Link } from "react-router-dom";
import { useTranslation } from "@internal/i18n";
import { useCurrentUser } from "../../auth";
import { BrandMark } from "../Brand";
import {
  AccountIcon,
  AdminIcon,
  BoardIcon,
  BotIcon,
  CubeIcon,
  HomeIcon,
  ObservabilityIcon,
  PinIcon,
  PinOffIcon,
  PlugIcon,
  ScaffolderIcon,
  SkillIcon,
  SparklesIcon,
  TeamsIcon,
} from "../../widgets/toolkit/icons";
import type { SidebarSection } from "./sectionFromPath";
import { useSidebar } from "./SidebarContext";

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
  { key: "workspace", to: "/projects", label: "Projects", icon: BoardIcon },
  { key: "agents", to: "/agents", label: "Agents", icon: SparklesIcon },
  { key: "skills", to: "/skills", label: "Skills", icon: SkillIcon, adminOnly: true },
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

const FOOTER: Array<{ to: string; key: string; label: string; icon: () => ReactNode }> = [
  { to: "/settings", key: "settings", label: "Settings", icon: AccountIcon },
];

const RAIL_WIDTH_KEY = "mep:sidebar-width";
const RAIL_MIN_WIDTH = 168;
const RAIL_MAX_WIDTH = 360;
const RAIL_DEFAULT_WIDTH = 208;

const clampRailWidth = (w: number) => Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, w));

function readRailWidth(): number {
  if (typeof window === "undefined") return RAIL_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(RAIL_WIDTH_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(n) ? clampRailWidth(n) : RAIL_DEFAULT_WIDTH;
  } catch {
    return RAIL_DEFAULT_WIDTH;
  }
}

export function Rail() {
  const me = useCurrentUser();
  const { pinned, togglePinned, peeking, onRailMouseEnter, onRailMouseLeave } = useSidebar();
  const isAdmin = me.role === "admin";

  const sections = useMemo(() => SECTIONS.filter((s) => !s.adminOnly || isAdmin), [isAdmin]);

  const [width, setWidth] = useState<number>(() => readRailWidth());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_WIDTH_KEY, String(width));
    } catch {
      // ignore persistence failure
    }
  }, [width]);

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampRailWidth(drag.startW + (e.clientX - drag.startX)));
  };
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };
  const onResizeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      setWidth((w) => clampRailWidth(w - 16));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setWidth((w) => clampRailWidth(w + 16));
      e.preventDefault();
    }
  };

  return (
    <>
      <div
        onMouseEnter={onRailMouseEnter}
        onMouseLeave={onRailMouseLeave}
        style={pinned ? { width } : undefined}
        className={`shrink-0 bg-app-surface ${dragging ? "" : "transition-[width] duration-150"} ${
          pinned ? "" : "w-14 border-r border-app-border"
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
          />
        )}
      </div>

      {/* Drag handle doubles as the rail's right border while pinned. */}
      {pinned && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onKeyDown={onResizeKey}
          onDoubleClick={() => setWidth(RAIL_DEFAULT_WIDTH)}
          className="relative z-10 w-px shrink-0 cursor-col-resize bg-app-border transition-colors hover:bg-app-primary focus:outline-none focus-visible:bg-app-primary"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" aria-hidden />
        </div>
      )}

      {/* Overlay must reuse the rail's enter/leave so peek survives crossing the visual boundary. */}
      {peeking && !pinned && (
        <div
          onMouseEnter={onRailMouseEnter}
          onMouseLeave={onRailMouseLeave}
          style={{ width }}
          className="absolute left-0 top-0 z-40 h-full border-r border-app-border bg-app-surface shadow-xl"
        >
          <RailContent
            expanded={true}
            sections={sections}
            footer={FOOTER}
            pinned={pinned}
            onTogglePin={togglePinned}
          />
        </div>
      )}
    </>
  );
}

interface RailContentProps {
  expanded: boolean;
  sections: SectionDef[];
  footer: Array<{ to: string; key: string; label: string; icon: () => ReactNode }>;
  pinned: boolean;
  onTogglePin: () => void;
}

function RailContent({ expanded, sections, footer, pinned, onTogglePin }: RailContentProps) {
  const { t } = useTranslation();
  return (
    <nav className="flex h-full flex-col gap-1 p-2">
      <Link
        to="/"
        aria-label="HiveDP"
        className="flex h-10 items-center gap-2 rounded-md px-2 hover:bg-app-surface-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <BrandMark className="h-6 w-6 text-app-text" />
        </span>
        {expanded && (
          <span className="text-lg font-bold leading-none tracking-tight">
            <span className="text-app-text">Hive</span>
            <span className="text-app-primary">DP</span>
          </span>
        )}
      </Link>

      <div className="my-1 border-t border-app-border" aria-hidden />

      <button
        type="button"
        onClick={onTogglePin}
        title={pinned ? t("nav.unpinSidebar") : t("nav.pinSidebar")}
        aria-label={pinned ? t("nav.unpinSidebar") : t("nav.pinSidebar")}
        className="flex h-10 items-center gap-3 rounded-md px-2 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          {pinned ? <PinOffIcon /> : <PinIcon />}
        </span>
        {expanded && <span className="text-sm">{pinned ? t("nav.unpin") : t("nav.pin")}</span>}
      </button>

      <div className="my-1 border-t border-app-border" aria-hidden />

      {sections.map(({ key, to, label: rawLabel, icon: Icon }) => {
        const label = t(`nav.${key}`, { defaultValue: rawLabel });
        return (
          <NavLink
            key={key}
            to={to}
            end={to === "/"}
            title={label}
            className={({ isActive }) =>
              `relative flex h-10 items-center gap-3 rounded-md px-2 transition-colors ${
                isActive
                  ? "bg-app-primary/15 text-app-primary font-medium"
                  : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
              }`
            }
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
              <Icon />
            </span>
            {expanded && <span className="flex-1 truncate text-sm">{label}</span>}
          </NavLink>
        );
      })}

      <div className="mt-auto flex flex-col gap-1">
        <div className="my-1 border-t border-app-border" aria-hidden />
        {footer.map(({ to, key, label: rawLabel, icon: Icon }) => {
          const label = t(`nav.${key}`, { defaultValue: rawLabel });
          return (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                `flex h-10 items-center gap-3 rounded-md px-2 transition-colors ${
                  isActive
                    ? "bg-app-primary/15 text-app-primary font-medium"
                    : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
                }`
              }
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <Icon />
              </span>
              {expanded && <span className="truncate text-sm">{label}</span>}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
