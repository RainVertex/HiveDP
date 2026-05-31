// Thin typed wrapper around the Grafana HTTP API; Prometheus/Loki/Tempo are reached only via Grafana's datasource proxy.
// One client maps to one Integration (baseUrl + service-account token); stateless and safe to instantiate per-request.
import type { LokiLogLine, TempoSpan, TempoTrace } from "@internal/shared-types";
import type {
  GrafanaClientConfig,
  GrafanaDataSource,
  LokiQueryResult,
  LokiRange,
  PromInstantResult,
  PromRange,
  PromRangeResult,
  RenderPanelOpts,
  TempoApiResponse,
  TempoApiSpan,
  TempoAttrValue,
} from "./types";

export * from "./types";

export class GrafanaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "GrafanaApiError";
  }
}

export interface LogsQueryOpts {
  // Overrides the default trace-id regex set; first capture group is the trace ID.
  traceIdRegex?: string;
}

export interface GrafanaClient {
  listDataSources(): Promise<GrafanaDataSource[]>;
  proxy(dsUid: string, path: string, init?: RequestInit): Promise<Response>;
  query(dsUid: string, promql: string, opts?: { time?: Date }): Promise<PromInstantResult>;
  rangeQuery(dsUid: string, promql: string, range: PromRange): Promise<PromRangeResult>;
  logsQuery(
    dsUid: string,
    logql: string,
    range: LokiRange,
    opts?: LogsQueryOpts,
  ): Promise<LokiLogLine[]>;
  traceById(dsUid: string, traceId: string): Promise<TempoTrace>;
  checkImageRenderer(): Promise<boolean>;
  renderPanel(opts: RenderPanelOpts): Promise<Buffer>;
}

// Ordered most-specific first so structured fields win over the unstructured `traceID=` form, which can match neighboring text.
const DEFAULT_TRACE_ID_REGEXES: RegExp[] = [
  /"trace_id"\s*:\s*"([0-9a-f]{16,32})"/i,
  /traceparent:\s*\d+-([0-9a-f]{32})-/i,
  /trace[_-]?id["=:\s]+([0-9a-f]{16,32})/i,
];

function compileTraceRegexes(override?: string): RegExp[] {
  if (!override) return DEFAULT_TRACE_ID_REGEXES;
  try {
    return [new RegExp(override, "i")];
  } catch {
    return DEFAULT_TRACE_ID_REGEXES;
  }
}

function extractTraceId(line: string, regexes: RegExp[]): string | null {
  for (const re of regexes) {
    const m = re.exec(line);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

export function createGrafanaClient(config: GrafanaClientConfig): GrafanaClient {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const authHeader = { Authorization: `Bearer ${config.apiToken}` };

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl}${path}`;
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        ...authHeader,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GrafanaApiError(
        res.status,
        `Grafana API ${init?.method ?? "GET"} ${path} -> ${res.status}`,
        body,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function rawProxy(dsUid: string, path: string, init?: RequestInit): Promise<Response> {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = `${baseUrl}/api/datasources/proxy/uid/${dsUid}${normalized}`;
    return fetchImpl(url, {
      ...init,
      headers: {
        ...authHeader,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function proxyJson<T>(dsUid: string, path: string, init?: RequestInit): Promise<T> {
    const res = await rawProxy(dsUid, path, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GrafanaApiError(
        res.status,
        `Grafana datasource proxy ${dsUid} ${init?.method ?? "GET"} ${path} -> ${res.status}`,
        body,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  function attrsToObject(
    attrs: Array<{ key: string; value?: TempoAttrValue }> | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!attrs) return out;
    for (const a of attrs) {
      const v = a.value;
      if (!v) continue;
      if (v.stringValue !== undefined) out[a.key] = v.stringValue;
      else if (v.intValue !== undefined) out[a.key] = Number(v.intValue);
      else if (v.boolValue !== undefined) out[a.key] = v.boolValue;
      else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    }
    return out;
  }

  function nsToMs(ns: string | number | undefined): number {
    if (ns === undefined) return 0;
    // Divide as BigInt to avoid the float precision loss `Number(bigNs) / 1e6` brings for nanosecond timestamps.
    try {
      const big = typeof ns === "string" ? BigInt(ns) : BigInt(Math.trunc(ns));
      return Number(big / 1_000_000n);
    } catch {
      return 0;
    }
  }

  function normalizeTempo(payload: TempoApiResponse, traceId: string): TempoTrace {
    const spans: TempoSpan[] = [];
    let rootService = "unknown";
    let rootName = "unknown";
    let traceStartMs = Number.POSITIVE_INFINITY;
    let traceEndMs = 0;

    for (const batch of payload.batches ?? []) {
      const resourceAttrs = attrsToObject(batch.resource?.attributes);
      const service =
        (resourceAttrs["service.name"] as string | undefined) ??
        (resourceAttrs.service as string | undefined) ??
        "unknown";

      const rawSpans: TempoApiSpan[] = [];
      for (const scope of batch.scopeSpans ?? []) {
        if (scope.spans) rawSpans.push(...scope.spans);
      }
      for (const scope of batch.instrumentationLibrarySpans ?? []) {
        if (scope.spans) rawSpans.push(...scope.spans);
      }

      for (const s of rawSpans) {
        const startMs = nsToMs(s.startTimeUnixNano);
        const endMs = nsToMs(s.endTimeUnixNano);
        const durationMs = Math.max(0, endMs - startMs);
        const attrs = attrsToObject(s.attributes);
        spans.push({
          spanId: s.spanId,
          parentSpanId: s.parentSpanId ? s.parentSpanId : null,
          name: s.name,
          service,
          startMs,
          durationMs,
          attributes: attrs,
        });
        if (startMs < traceStartMs) traceStartMs = startMs;
        if (endMs > traceEndMs) traceEndMs = endMs;
        if (!s.parentSpanId) {
          rootService = service;
          rootName = s.name;
        }
      }
    }

    spans.sort((a, b) => a.startMs - b.startMs);
    const durationMs = traceEndMs > traceStartMs ? traceEndMs - traceStartMs : 0;
    return { traceId, rootService, rootName, durationMs, spans };
  }

  return {
    listDataSources: () => request<GrafanaDataSource[]>("/api/datasources"),

    proxy: (dsUid, path, init) => rawProxy(dsUid, path, init),

    query: async (dsUid, promql, opts) => {
      const qs = new URLSearchParams({ query: promql });
      if (opts?.time) qs.set("time", String(Math.floor(opts.time.getTime() / 1000)));
      return proxyJson<PromInstantResult>(dsUid, `/api/v1/query?${qs.toString()}`);
    },

    rangeQuery: async (dsUid, promql, range) => {
      const qs = new URLSearchParams({
        query: promql,
        start: String(Math.floor(range.start.getTime() / 1000)),
        end: String(Math.floor(range.end.getTime() / 1000)),
        step: String(range.stepSec),
      });
      return proxyJson<PromRangeResult>(dsUid, `/api/v1/query_range?${qs.toString()}`);
    },

    logsQuery: async (dsUid, logql, range, opts) => {
      const regexes = compileTraceRegexes(opts?.traceIdRegex);
      const qs = new URLSearchParams({
        query: logql,
        // Loki expects nanoseconds.
        start: `${range.start.getTime()}000000`,
        end: `${range.end.getTime()}000000`,
        limit: String(range.limit ?? 200),
        direction: range.direction ?? "backward",
      });
      const payload = await proxyJson<LokiQueryResult>(
        dsUid,
        `/loki/api/v1/query_range?${qs.toString()}`,
      );
      const out: LokiLogLine[] = [];
      for (const stream of payload.data.result ?? []) {
        const labels = stream.stream ?? {};
        for (const [tsNs, line] of stream.values ?? []) {
          const tsMs = Math.floor(Number(tsNs) / 1_000_000);
          out.push({
            ts: new Date(tsMs).toISOString(),
            line,
            labels,
            traceId: extractTraceId(line, regexes),
          });
        }
      }
      // Loki returns oldest-first per stream; re-sort newest-first to match the panel UI.
      out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      return out;
    },

    traceById: async (dsUid, traceId) => {
      const payload = await proxyJson<TempoApiResponse>(dsUid, `/api/traces/${traceId}`);
      return normalizeTempo(payload, traceId);
    },

    checkImageRenderer: async () => {
      // Non-200 from the plugin settings endpoint means absent/disabled, so the embed endpoint degrades cleanly.
      try {
        const res = await fetchImpl(`${baseUrl}/api/plugins/grafana-image-renderer/settings`, {
          headers: authHeader,
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    renderPanel: async (opts) => {
      const qs = new URLSearchParams({
        panelId: String(opts.panelId),
      });
      if (opts.from) qs.set("from", opts.from);
      if (opts.to) qs.set("to", opts.to);
      if (opts.width) qs.set("width", String(opts.width));
      if (opts.height) qs.set("height", String(opts.height));
      const url = `${baseUrl}/render/d-solo/${encodeURIComponent(opts.dashboardUid)}?${qs.toString()}`;
      const res = await fetchImpl(url, { headers: authHeader });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GrafanaApiError(
          res.status,
          `Grafana panel render ${opts.dashboardUid}/${opts.panelId} -> ${res.status}`,
          body,
        );
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    },
  };
}
