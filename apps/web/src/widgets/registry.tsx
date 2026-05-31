import type { WidgetDefinition, WidgetInstance, WidgetRegistry } from "@internal/shared-ui";
import type { WidgetId } from "./types";
import { OnboardingWidget } from "@feature/onboarding-frontend";
import { SearchWidget } from "./search";
import { StarredEntitiesWidget } from "./starred";
import { ToolkitWidget } from "./toolkit";
import { RecentlyVisitedWidget } from "./recently-visited";
import { TopVisitedWidget } from "./top-visited";
import { ChatAssistantWidget } from "./chat";
import { MyTasksWidget } from "./projects";
import { ServiceHealthWidget } from "./grafana/ServiceHealthWidget";
import { GrafanaAlertsWidget } from "./grafana/GrafanaAlertsWidget";
import { MarkdownWidget } from "./markdown/MarkdownWidget";
import { MarkdownConfigEditor } from "./markdown/MarkdownConfigEditor";
import { IframeWidget } from "./iframe/IframeWidget";
import { IframeConfigEditor } from "./iframe/IframeConfigEditor";
export type HomeWidgetDefinition = WidgetDefinition<WidgetId>;
export type HomeWidgetInstance = WidgetInstance<WidgetId>;

export const WIDGETS: WidgetRegistry<WidgetId> = {
  search: {
    id: "search",
    category: "Discovery",
    title: "Search",
    description: "Quick search across the platform.",
    component: SearchWidget,
    defaultSize: { w: 12, h: 2 },
    minSize: { w: 4, h: 2 },
  },
  onboarding: {
    id: "onboarding",
    category: "Work",
    title: "Get started",
    description: "Onboarding tasks for new developers.",
    component: OnboardingWidget,
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
    surfaces: ["home"],
  },
  starred: {
    id: "starred",
    category: "Discovery",
    title: "Your Starred Entities",
    description: "Catalog entities you've starred.",
    component: StarredEntitiesWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  toolkit: {
    id: "toolkit",
    category: "Discovery",
    title: "Toolkit",
    description: "Shortcuts to your most-used tools.",
    component: ToolkitWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  "recently-visited": {
    id: "recently-visited",
    category: "Discovery",
    title: "Recently Visited",
    description: "Pages you opened most recently.",
    component: RecentlyVisitedWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  "top-visited": {
    id: "top-visited",
    category: "Discovery",
    title: "Top Visited",
    description: "Pages you open most often.",
    component: TopVisitedWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  "chat-assistant": {
    id: "chat-assistant",
    category: "Work",
    title: "Platform Assistant",
    description: "Chat with the assistant without leaving the page.",
    component: ChatAssistantWidget,
    defaultSize: { w: 6, h: 7 },
    minSize: { w: 4, h: 5 },
    surfaces: ["home"],
  },
  "service-health": {
    id: "service-health",
    category: "Observability",
    title: "Service Health",
    description: "Latest health samples written by the Prometheus scrape job.",
    component: ServiceHealthWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  "my-tasks": {
    id: "my-tasks",
    category: "Work",
    title: "My Tasks",
    description: "Open tasks assigned to you.",
    component: MyTasksWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  "grafana-alerts": {
    id: "grafana-alerts",
    category: "Observability",
    title: "Grafana Alerts",
    description: "Recent firing and resolved alerts from Grafana Alertmanager.",
    component: GrafanaAlertsWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  markdown: {
    id: "markdown",
    category: "Content",
    title: "Markdown",
    description: "Rich text block. Supports GitHub-flavored markdown.",
    component: MarkdownWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 2, h: 2 },
    defaultConfig: { body: "" },
    configEditor: MarkdownConfigEditor,
    surfaces: ["dashboard"],
  },
  iframe: {
    id: "iframe",
    category: "Content",
    title: "Embed",
    description: "Embed an external https:// page (Grafana, dashboards, docs).",
    component: IframeWidget,
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 3, h: 3 },
    defaultConfig: { url: "" },
    configEditor: IframeConfigEditor,
    surfaces: ["dashboard"],
  },
};

export const WIDGET_LIST: HomeWidgetDefinition[] = Object.values(WIDGETS);

function widgetOnSurface(def: HomeWidgetDefinition, surface: "home" | "dashboard"): boolean {
  return (def.surfaces ?? ["home", "dashboard"]).includes(surface);
}

export const HOME_WIDGET_LIST: HomeWidgetDefinition[] = WIDGET_LIST.filter((w) =>
  widgetOnSurface(w, "home"),
);

export const DASHBOARD_WIDGET_LIST: HomeWidgetDefinition[] = WIDGET_LIST.filter((w) =>
  widgetOnSurface(w, "dashboard"),
);

export const DEFAULT_WIDGETS: HomeWidgetInstance[] = [
  { i: "search-1", widgetId: "search", x: 0, y: 0, w: 12, h: 2 },
  { i: "onboarding-1", widgetId: "onboarding", x: 0, y: 2, w: 12, h: 4 },
  { i: "starred-1", widgetId: "starred", x: 0, y: 6, w: 6, h: 5 },
  { i: "toolkit-1", widgetId: "toolkit", x: 6, y: 6, w: 6, h: 5 },
  { i: "recently-visited-1", widgetId: "recently-visited", x: 0, y: 11, w: 6, h: 4 },
  { i: "top-visited-1", widgetId: "top-visited", x: 6, y: 11, w: 6, h: 4 },
  { i: "chat-assistant-1", widgetId: "chat-assistant", x: 0, y: 15, w: 6, h: 7 },
];
