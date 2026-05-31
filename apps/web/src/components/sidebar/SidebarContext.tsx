// Sidebar state: pin/peek behavior and resolution of the active rail section.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation } from "react-router-dom";
import { sectionFromPath, sectionHasTree, type SidebarSection } from "./sectionFromPath";
import type { PageSection } from "@internal/shared-types";

const PIN_STORAGE_KEY = "mep:sidebar-pinned";
const HOVER_DELAY_MS = 150;

function readPinned(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PIN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface SidebarContextValue {
  pinned: boolean;
  setPinned: (next: boolean) => void;
  togglePinned: () => void;
  peeking: boolean;
  expanded: boolean;
  onRailMouseEnter: () => void;
  onRailMouseLeave: () => void;
  activeSection: SidebarSection;
  setRouteSection: (section: PageSection | null) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: PropsWithChildren) {
  const [pinned, setPinnedState] = useState<boolean>(() => readPinned());
  const [peeking, setPeeking] = useState(false);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const location = useLocation();

  const pathSection = useMemo(() => sectionFromPath(location.pathname), [location.pathname]);

  // Sticky so navigating into a dashboard page keeps the tree the user was in; persisted across reloads.
  const [stickySection, setStickySection] = useState<PageSection>(() => {
    if (typeof window === "undefined") return "catalog";
    try {
      const raw = window.localStorage.getItem("mep:sidebar-last-tree-section");
      if (raw && raw !== "home" && raw !== "account") return raw as PageSection;
    } catch {
      // ignore
    }
    return "catalog";
  });

  // Explicit override set by a route component once a deep-linked page resolves.
  const [routeSection, setRouteSection] = useState<PageSection | null>(null);

  useEffect(() => {
    if (sectionHasTree(pathSection)) {
      setStickySection(pathSection);
      try {
        window.localStorage.setItem("mep:sidebar-last-tree-section", pathSection);
      } catch {
        // ignore
      }
    }
  }, [pathSection]);

  // Resolution order: explicit route override, then URL section with a tree, then sticky.
  const activeSection: SidebarSection = useMemo(() => {
    if (routeSection) return routeSection;
    if (sectionHasTree(pathSection)) return pathSection;
    if (pathSection === "account") return pathSection;
    if (location.pathname.startsWith("/p/")) return stickySection;
    return pathSection;
  }, [routeSection, pathSection, stickySection, location.pathname]);

  // Reset the route override on navigation so the next dashboard page starts clean.
  useEffect(() => {
    if (!location.pathname.startsWith("/p/")) setRouteSection(null);
  }, [location.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, pinned ? "true" : "false");
    } catch {
      // ignore persistence failure
    }
  }, [pinned]);

  const clearTimers = useCallback(() => {
    if (enterTimer.current != null) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const onRailMouseEnter = useCallback(() => {
    if (pinned) return;
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (peeking) return;
    enterTimer.current = window.setTimeout(() => setPeeking(true), HOVER_DELAY_MS);
  }, [pinned, peeking]);

  const onRailMouseLeave = useCallback(() => {
    if (pinned) return;
    if (enterTimer.current != null) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    leaveTimer.current = window.setTimeout(() => setPeeking(false), HOVER_DELAY_MS);
  }, [pinned]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const togglePinned = useCallback(() => {
    setPinnedState((prev) => {
      const next = !prev;
      // Pinning while peeking must not leave the overlay flag stuck on.
      if (next) setPeeking(false);
      return next;
    });
  }, []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      pinned,
      setPinned: setPinnedState,
      togglePinned,
      peeking,
      expanded: pinned || peeking,
      onRailMouseEnter,
      onRailMouseLeave,
      activeSection,
      setRouteSection,
    }),
    [pinned, togglePinned, peeking, onRailMouseEnter, onRailMouseLeave, activeSection],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used inside <SidebarProvider>");
  return ctx;
}
