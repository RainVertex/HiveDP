// Seeded agents are referenced by FK and the enrichment cron, so they cannot be deleted.
export const PROTECTED_AGENT_IDS = new Set(["seed-agent-assistant", "seed-agent-catalog-enricher"]);
