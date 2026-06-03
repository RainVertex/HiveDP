-- Consolidate search on Postgres FTS + pg_trgm. Idempotent and safe to re-run.

-- pg_trgm powers fuzzy similarity() and trigram GIN indexes below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Formalize the DocPage tsvector that devdocs/search.ts already queries. The
-- column was created out-of-band, this brings it under migration control.
-- Expression mirrors devdocs/search.ts: to_tsvector('english', title || body).
ALTER TABLE "DocPage" ADD COLUMN IF NOT EXISTS "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("title",'') || ' ' || coalesce("body",''))) STORED;
CREATE INDEX IF NOT EXISTS "DocPage_searchVector_idx" ON "DocPage" USING GIN ("searchVector");

-- pg_trgm GIN indexes for fuzzy name/title search on high-value short columns.
CREATE INDEX IF NOT EXISTS "CatalogEntity_name_trgm_idx" ON "CatalogEntity" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Project_title_trgm_idx" ON "Project" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_title_trgm_idx" ON "Task" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Team_name_trgm_idx" ON "Team" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Page_title_trgm_idx" ON "Page" USING GIN ("title" gin_trgm_ops);
