// Overview widget that renders an entity's catalog relations as an SVG star graph.
import { useEffect, useState } from "react";
import { useApi } from "@internal/api-client/react";
import type { CatalogRelation, CatalogRelationsResponse } from "@internal/shared-types";
import { useEntityOverviewContext } from "../EntityOverviewContext";

const RELATION_COLOR: Record<string, string> = {
  dependsOn: "var(--color-app-primary)",
  dependencyOf: "var(--color-app-primary)",
  consumesApi: "var(--color-app-success, #10b981)",
  apiConsumedBy: "var(--color-app-success, #10b981)",
  providesApi: "var(--color-app-success, #10b981)",
  apiProvidedBy: "var(--color-app-success, #10b981)",
  partOf: "var(--color-app-warning, #f59e0b)",
  hasPart: "var(--color-app-warning, #f59e0b)",
  ownedBy: "var(--color-app-text-muted)",
  ownerOf: "var(--color-app-text-muted)",
};

export function RelationsGraphWidget() {
  const { data } = useEntityOverviewContext();
  const entityId = data.entity.id;
  const entityName = data.entity.name;
  const api = useApi();
  const [relations, setRelations] = useState<CatalogRelationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRelations(null);
    setError(null);
    api.catalog
      .relations(entityId)
      .then((res) => {
        if (!cancelled) setRelations(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [api, entityId]);

  if (error) {
    return <p className="text-sm text-app-danger">{error}</p>;
  }
  if (!relations) {
    return <p className="text-sm text-app-text-muted">Loading…</p>;
  }

  const all: Array<CatalogRelation & { direction: "out" | "in" }> = [
    ...relations.outgoing.map((r) => ({ ...r, direction: "out" as const })),
    ...relations.incoming.map((r) => ({ ...r, direction: "in" as const })),
  ];

  if (all.length === 0) {
    return (
      <p className="text-sm text-app-text-muted">
        No relations declared in <code>catalog-info.yaml</code>.
      </p>
    );
  }

  // Star layout: this entity at center, related entities arranged on a circle.
  const W = 540;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) / 2 - 60;
  const labelOf = (r: CatalogRelation) => r.target?.name ?? r.rawRef;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Relations graph"
    >
      {all.map((r, i) => {
        const angle = (2 * Math.PI * i) / all.length - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        const color = RELATION_COLOR[r.type] ?? "var(--color-app-text-muted)";
        return (
          <g key={`${r.type}-${r.rawRef}-${i}`}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={1.2} opacity={0.6} />
            <text
              x={(cx + x) / 2}
              y={(cy + y) / 2 - 4}
              fontSize={9}
              textAnchor="middle"
              fill="var(--color-app-text-muted)"
            >
              {r.direction === "out" ? r.type : `← ${r.type}`}
            </text>
            <NodePill
              x={x}
              y={y}
              label={labelOf(r)}
              kind={r.target?.kind ?? "?"}
              muted={!r.target}
            />
          </g>
        );
      })}
      <NodePill x={cx} y={cy} label={entityName} kind="this" highlight />
    </svg>
  );
}

function NodePill({
  x,
  y,
  label,
  kind,
  highlight,
  muted,
}: {
  x: number;
  y: number;
  label: string;
  kind: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  const w = Math.max(80, label.length * 6 + 24);
  const h = 26;
  const fill = highlight
    ? "var(--color-app-primary)"
    : muted
      ? "var(--color-app-surface-hover)"
      : "var(--color-app-surface)";
  const stroke = highlight ? "var(--color-app-primary)" : "var(--color-app-border)";
  const text = highlight ? "var(--color-app-primary-on)" : "var(--color-app-text)";
  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <rect width={w} height={h} rx={13} fill={fill} stroke={stroke} strokeWidth={1} />
      <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fontSize={11} fill={text}>
        {label}
      </text>
      <text
        x={w / 2}
        y={h + 12}
        textAnchor="middle"
        fontSize={9}
        fill="var(--color-app-text-muted)"
      >
        {kind}
      </text>
    </g>
  );
}
