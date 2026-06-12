import { getDevDocsSearchHits, resolveOrgScope } from "@feature/catalog-backend/contract";
import type { SearchSource } from "./types";

// DevDocs keep their tsvector ranking, non admins only see docs in their org scope.
export const devdocs: SearchSource = async (query, ctx, limit) => {
  const scope = await resolveOrgScope(ctx.userId, ctx.isAdmin);
  if (scope === null) return getDevDocsSearchHits(query, limit);
  return getDevDocsSearchHits(query, limit, { accountLogins: scope });
};
