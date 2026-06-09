// Public cross-feature contract. Other feature backends import from "@feature/scaffolder-backend/contract".
// Keep this surface small and intentional. The main barrel (./index) is for the api shell only.
export { parseGithubUrl, discoverAndPersist, type DiscoverAndPersistResult } from "./index";
