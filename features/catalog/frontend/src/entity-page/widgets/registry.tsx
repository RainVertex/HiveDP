import type { WidgetDefinition, WidgetInstance, WidgetRegistry } from "@internal/shared-ui";
import { DetailsWidget } from "./DetailsWidget";
import { ScorecardsWidget } from "./ScorecardsWidget";
import { RelationsGraphWidget } from "./RelationsGraphWidget";
import { LinksWidget } from "./LinksWidget";
import { DoraChartWidget } from "./DoraChartWidget";
import { PipelinesWidget } from "./PipelinesWidget";

export type EntityWidgetId =
  | "details"
  | "scorecards"
  | "relations-graph"
  | "links"
  | "dora-chart"
  | "pipelines";

export type EntityWidgetDefinition = WidgetDefinition<EntityWidgetId>;
export type EntityWidgetInstance = WidgetInstance<EntityWidgetId>;

export const ENTITY_WIDGETS: WidgetRegistry<EntityWidgetId> = {
  details: {
    id: "details",
    title: "Details",
    description: "Entity metadata, owners, and lifecycle.",
    component: DetailsWidget,
    defaultSize: { w: 8, h: 9 },
    minSize: { w: 4, h: 4 },
  },
  scorecards: {
    id: "scorecards",
    title: "Service Scorecards",
    description: "Health scores for this entity.",
    component: ScorecardsWidget,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 3 },
  },
  "relations-graph": {
    id: "relations-graph",
    title: "Relations",
    description: "Graph of dependencies and consumers.",
    component: RelationsGraphWidget,
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 4, h: 4 },
  },
  links: {
    id: "links",
    title: "Links",
    description: "External links for this entity.",
    component: LinksWidget,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  "dora-chart": {
    id: "dora-chart",
    title: "DORA Metrics",
    description: "Deployment frequency, lead time, CFR, and MTTR over time.",
    component: DoraChartWidget,
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 4, h: 4 },
  },
  pipelines: {
    id: "pipelines",
    title: "CI/CD",
    description: "Recent workflow runs and deployment state per environment.",
    component: PipelinesWidget,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 4 },
  },
};

export const ENTITY_WIDGET_LIST: EntityWidgetDefinition[] = Object.values(ENTITY_WIDGETS);

export const DEFAULT_ENTITY_WIDGETS: EntityWidgetInstance[] = [
  { i: "details-1", widgetId: "details", x: 0, y: 0, w: 8, h: 9 },
  { i: "scorecards-1", widgetId: "scorecards", x: 8, y: 0, w: 4, h: 6 },
  { i: "links-1", widgetId: "links", x: 8, y: 6, w: 4, h: 5 },
  { i: "relations-graph-1", widgetId: "relations-graph", x: 0, y: 9, w: 8, h: 6 },
  { i: "pipelines-1", widgetId: "pipelines", x: 8, y: 11, w: 4, h: 6 },
  { i: "dora-chart-1", widgetId: "dora-chart", x: 0, y: 15, w: 8, h: 6 },
];

export function entityLayoutStorageKey(entityId: string): string {
  return `mep:entity-overview-layout:${entityId}`;
}
