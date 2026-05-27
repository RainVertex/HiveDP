import type { ID } from "./common";

export interface SearchHit {
  id: ID;
  kind: "catalog" | "team" | "agent" | "devdoc";
  title: string;
  snippet?: string;
  /** For devdoc hits: routes the user to the entity's docs tab + page slug. */
  href?: string;
}

export interface SearchResults {
  query: string;
  hits: SearchHit[];
}
