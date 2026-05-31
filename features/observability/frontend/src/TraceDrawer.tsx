// Drawer that fetches a Tempo trace by id and renders a CSS-bar span waterfall.

import { useEffect, useMemo, useState } from "react";
import type { TempoSpan, TempoTrace } from "@internal/shared-types";
import { useApi } from "@internal/api-client/react";

export interface TraceDrawerProps {
  traceId: string;
  // Required for authorization: backend gates trace access on read perms for this entity.
  entityId: string;
  onClose: () => void;
}

interface SpanWithDepth extends TempoSpan {
  depth: number;
}

function withDepths(spans: TempoSpan[]): SpanWithDepth[] {
  const byId = new Map<string, TempoSpan>();
  for (const s of spans) byId.set(s.spanId, s);
  const depthCache = new Map<string, number>();
  function depthOf(s: TempoSpan): number {
    const cached = depthCache.get(s.spanId);
    if (cached !== undefined) return cached;
    if (!s.parentSpanId) {
      depthCache.set(s.spanId, 0);
      return 0;
    }
    const parent = byId.get(s.parentSpanId);
    const d = parent ? depthOf(parent) + 1 : 0;
    depthCache.set(s.spanId, d);
    return d;
  }
  return spans.map((s) => ({ ...s, depth: depthOf(s) }));
}

export function TraceDrawer({ traceId, entityId, onClose }: TraceDrawerProps) {
  const api = useApi();
  const [trace, setTrace] = useState<TempoTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTrace(null);
    setError(null);
    api.observability
      .trace(traceId, { entityId })
      .then((res) => {
        if (!cancelled) setTrace(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load trace");
      });
    return () => {
      cancelled = true;
    };
  }, [api, traceId, entityId]);

  const spans = useMemo(() => (trace ? withDepths(trace.spans) : []), [trace]);
  const traceStart = useMemo(
    () => (spans.length ? Math.min(...spans.map((s) => s.startMs)) : 0),
    [spans],
  );
  const totalMs = trace?.durationMs ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-2xl overflow-y-auto bg-app-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-app-text">Trace</h3>
            <p className="text-xs text-app-text-muted">
              {trace ? `${trace.rootService} · ${trace.rootName} · ${trace.durationMs}ms` : traceId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-app-text-muted hover:bg-app-surface-hover"
          >
            Close
          </button>
        </header>
        {error && <p className="text-xs text-app-danger">{error}</p>}
        {!error && trace === null && <p className="text-xs text-app-text-muted">Loading…</p>}
        {trace && (
          <ul className="space-y-0.5 text-xs">
            {spans.map((span) => {
              const offsetPct =
                totalMs > 0 ? Math.max(0, ((span.startMs - traceStart) / totalMs) * 100) : 0;
              const widthPct = totalMs > 0 ? Math.max(1, (span.durationMs / totalMs) * 100) : 100;
              return (
                <li key={span.spanId} className="grid grid-cols-[18rem_1fr] items-center gap-2">
                  <div
                    className="truncate text-app-text"
                    style={{ paddingLeft: `${span.depth * 12}px` }}
                    title={`${span.service} · ${span.name}`}
                  >
                    <span className="text-app-text-muted">{span.service}</span>{" "}
                    <span>{span.name}</span>
                  </div>
                  <div className="relative h-4 rounded bg-app-bg">
                    <div
                      className="absolute h-full rounded bg-app-primary/60"
                      style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                      title={`${span.durationMs}ms @ +${(span.startMs - traceStart).toFixed(0)}ms`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
