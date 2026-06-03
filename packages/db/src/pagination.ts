// Shared cursor-pagination helpers: parse/clamp request params and build a nextCursor page result.

interface ParsePageOptions {
  defaultTake?: number;
  maxTake?: number;
}

export interface ParsedPageParams {
  take: number;
  skip?: number;
  cursor?: { id: string };
}

// Clamps take to [1, maxTake] and turns a string cursor id into a Prisma cursor.
export function parsePageParams(
  query: { take?: unknown; cursor?: unknown; skip?: unknown },
  opts?: ParsePageOptions,
): ParsedPageParams {
  const defaultTake = opts?.defaultTake ?? 50;
  const maxTake = opts?.maxTake ?? 200;

  const rawTake = typeof query.take === "string" ? Number(query.take) : query.take;
  let take =
    typeof rawTake === "number" && Number.isFinite(rawTake) ? Math.trunc(rawTake) : defaultTake;
  take = Math.min(Math.max(take, 1), maxTake);

  const result: ParsedPageParams = { take };

  const rawSkip = typeof query.skip === "string" ? Number(query.skip) : query.skip;
  if (typeof rawSkip === "number" && Number.isFinite(rawSkip) && rawSkip > 0) {
    result.skip = Math.trunc(rawSkip);
  }

  if (typeof query.cursor === "string" && query.cursor.length > 0) {
    result.cursor = { id: query.cursor };
  }

  return result;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

// Standard take+1 pattern: callers fetch take+1 rows, this pops the extra and exposes the boundary id.
export function buildPageResult<T extends { id: string }>(rows: T[], take: number): PageResult<T> {
  if (rows.length > take) {
    const items = rows.slice(0, take);
    const nextCursor = items[items.length - 1]!.id;
    return { items, nextCursor };
  }
  return { items: rows, nextCursor: null };
}
