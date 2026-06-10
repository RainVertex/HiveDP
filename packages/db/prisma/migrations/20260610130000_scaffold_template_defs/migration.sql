-- Port-style declarative template definitions managed via the admin API.
CREATE TABLE "ScaffoldTemplateDef" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScaffoldTemplateDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScaffoldTemplateDef_identifier_key" ON "ScaffoldTemplateDef"("identifier");

CREATE INDEX "ScaffoldTemplateDef_enabled_idx" ON "ScaffoldTemplateDef"("enabled");

ALTER TABLE "ScaffoldTemplateDef" ADD CONSTRAINT "ScaffoldTemplateDef_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
