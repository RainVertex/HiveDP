import { type RouteObject } from "react-router-dom";
import { TeamsPage } from "./TeamsPage";
import { TeamDetailPage } from "./TeamDetailPage";

export const featureRoutes: RouteObject[] = [
  { path: "/teams", element: <TeamsPage /> },
  { path: "/teams/:slug", element: <TeamDetailPage /> },
];
