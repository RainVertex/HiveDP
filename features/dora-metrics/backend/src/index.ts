import { Router } from "express";
import { prisma } from "@internal/db";
import { canViewEntityDetails, getVisibleOrgLogins } from "@feature/catalog-backend/contract";

export const doraMetricsRouter: Router = Router();

doraMetricsRouter.get("/", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const scope = await getVisibleOrgLogins(req.user);
  const snapshots = await prisma.doraMetricsSnapshot.findMany({
    ...(scope !== null ? { where: { entity: { accountLogin: { in: scope } } } } : {}),
    orderBy: { periodEnd: "desc" },
    take: 100,
  });
  res.json({ items: snapshots });
});

doraMetricsRouter.get("/entity/:entityId", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const entity = await prisma.catalogEntity.findUnique({
    where: { id: req.params.entityId },
    select: { accountLogin: true },
  });
  if (!entity) {
    res.status(404).json({ error: "Catalog entity not found" });
    return;
  }
  if (!(await canViewEntityDetails(req.user, entity.accountLogin))) {
    res.status(403).json({ error: "Org membership required" });
    return;
  }
  const snapshots = await prisma.doraMetricsSnapshot.findMany({
    where: { entityId: req.params.entityId },
    orderBy: { periodEnd: "desc" },
  });
  res.json({ items: snapshots });
});

import type { FeatureManifest } from "@internal/feature-host";

export const featureManifest: FeatureManifest = {
  mounts: [{ path: "/api/dora-metrics", router: doraMetricsRouter }],
};
