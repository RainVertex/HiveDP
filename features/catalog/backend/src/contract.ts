// Public cross-feature contract. Other feature backends import from "@feature/catalog-backend/contract".
// Keep this surface small and intentional. The main barrel (./index) is for the api shell only.
export {
  parseCatalogInfo,
  registerCatalogEntity,
  markStaleEntities,
  CATALOG_INFO_FILE_NAMES,
  getDevDocsSearchHits,
  expirePendingMemberships,
  runReconciliation,
  getVisibleOrgLogins,
  resolveOrgScope,
  isOrgVisible,
  canViewEntityDetails,
  visibleEntityWhere,
  requireEntityOrgAccess,
  type RegisterCatalogEntityInput,
  type OrgActor,
  type EntityOrgRef,
} from "./index";
