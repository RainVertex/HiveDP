import { getDevDocsSearchHits } from "@feature/catalog-backend/contract";
import type { SearchSource } from "./types";
import { userOrgLogins } from "./scope";

// DevDocs keep their tsvector ranking; org-scope non-admins so they only see docs in their orgs.
export const devdocs: SearchSource = async (query, ctx, limit) => {
  if (ctx.isAdmin) return getDevDocsSearchHits(query, limit);
  const accountLogins = await userOrgLogins(ctx.userId);
  if (accountLogins.length === 0) return [];
  return getDevDocsSearchHits(query, limit, { accountLogins });
};
