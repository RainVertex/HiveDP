import type { ComponentType } from "react";

export interface WidgetInstance<TId extends string = string> {
  i: string;
  widgetId: TId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per-instance configuration. */
  config?: Record<string, unknown>;
}

export interface WidgetComponentProps {
  config?: Record<string, unknown>;
}

export interface WidgetConfigEditorProps {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export type WidgetSurface = "home" | "dashboard";

export interface WidgetDefinition<TId extends string = string> {
  id: TId;
  title: string;
  description: string;
  component: ComponentType<WidgetComponentProps>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /** Initial config merged in when an instance is added via `addWidget`. */
  defaultConfig?: Record<string, unknown>;
  /** When set, the widget exposes a gear icon in edit mode that opens this editor. */
  configEditor?: ComponentType<WidgetConfigEditorProps>;
  /** Surfaces this widget can be added to. Omitted means available on both. */
  surfaces?: WidgetSurface[];
  /** Grouping label shown in the widget picker. Omitted falls under "General". */
  category?: string;
}

export type WidgetRegistry<TId extends string = string> = Record<TId, WidgetDefinition<TId>>;
