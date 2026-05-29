import { VikunjaClient } from "@internal/vikunja-client";

const WEBHOOK_EVENTS = [
  "task.created",
  "task.updated",
  "task.assigned",
  "task.deleted",
  "task.comment.created",
];

const loggedFailures = new Set<number>();

function buildWebhookUrl(): string | null {
  const base = process.env.NGROK_URL ?? process.env.PUBLIC_URL ?? process.env.WEB_ORIGIN;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/vikunja/webhook`;
}

export async function ensureProjectWebhook(
  client: VikunjaClient,
  externalProjectId: number,
): Promise<void> {
  const targetUrl = buildWebhookUrl();
  if (!targetUrl) return;

  try {
    const existing = await client.listProjectWebhooks(externalProjectId);
    if (existing.some((w) => w.target_url === targetUrl)) return;

    await client.createProjectWebhook(externalProjectId, {
      target_url: targetUrl,
      events: WEBHOOK_EVENTS,
      secret: process.env.VIKUNJA_WEBHOOK_SECRET || undefined,
    });
    loggedFailures.delete(externalProjectId);
  } catch (err) {
    if (!loggedFailures.has(externalProjectId)) {
      loggedFailures.add(externalProjectId);
      console.warn(
        `[vikunja webhook setup] project=${externalProjectId} failed (silenced until restart): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
