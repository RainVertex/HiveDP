// Upsert helpers — translate a Plane API payload into a mirror row. One
// function per resource. Each is idempotent and safe to retry: the
// `(integrationId, externalId)` (or `(projectId, externalId)`) unique key
// guarantees the same input always lands on the same row.
//
// Each upsert also stores the full upstream payload in a `raw Json` column
// so the sync layer can absorb schema additions in Plane without breaking
// reads. Derived fields (e.g. `completedAt`) are computed here and not
// stored in `raw` to keep that column a faithful copy of upstream.

import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  PlaneApiComment,
  PlaneApiCycle,
  PlaneApiLabel,
  PlaneApiMember,
  PlaneApiModule,
  PlaneApiProject,
  PlaneApiState,
  PlaneApiWorkItem,
  PlaneApiWorkspace,
} from "@internal/plane-client";

type Tx = PrismaClient | Prisma.TransactionClient;

export async function upsertWorkspace(
  tx: Tx,
  integrationId: string,
  raw: PlaneApiWorkspace,
): Promise<{ id: string }> {
  return tx.planeWorkspace.upsert({
    where: { integrationId_externalId: { integrationId, externalId: raw.id } },
    create: {
      integrationId,
      externalId: raw.id,
      slug: raw.slug,
      name: raw.name,
      logoUrl: raw.logo_url ?? null,
      lastSyncedAt: new Date(),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    update: {
      slug: raw.slug,
      name: raw.name,
      logoUrl: raw.logo_url ?? null,
      lastSyncedAt: new Date(),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export async function upsertProject(
  tx: Tx,
  integrationId: string,
  workspaceId: string,
  raw: PlaneApiProject,
): Promise<{ id: string }> {
  return tx.planeProject.upsert({
    where: { integrationId_externalId: { integrationId, externalId: raw.id } },
    create: {
      integrationId,
      workspaceId,
      externalId: raw.id,
      identifier: raw.identifier,
      name: raw.name,
      description: raw.description ?? null,
      emoji: raw.emoji ?? null,
      archivedAt: raw.archived_at ? new Date(raw.archived_at) : null,
      lastSyncedAt: new Date(),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    update: {
      identifier: raw.identifier,
      name: raw.name,
      description: raw.description ?? null,
      emoji: raw.emoji ?? null,
      archivedAt: raw.archived_at ? new Date(raw.archived_at) : null,
      lastSyncedAt: new Date(),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export async function upsertState(
  tx: Tx,
  projectId: string,
  raw: PlaneApiState,
): Promise<{ id: string; group: string }> {
  return tx.planeState.upsert({
    where: { projectId_externalId: { projectId, externalId: raw.id } },
    create: {
      projectId,
      externalId: raw.id,
      name: raw.name,
      color: raw.color ?? null,
      group: raw.group,
      order: raw.sequence,
      isDefault: raw.default,
    },
    update: {
      name: raw.name,
      color: raw.color ?? null,
      group: raw.group,
      order: raw.sequence,
      isDefault: raw.default,
    },
    select: { id: true, group: true },
  });
}

export async function upsertLabel(
  tx: Tx,
  projectId: string,
  raw: PlaneApiLabel,
): Promise<{ id: string }> {
  return tx.planeLabel.upsert({
    where: { projectId_externalId: { projectId, externalId: raw.id } },
    create: {
      projectId,
      externalId: raw.id,
      name: raw.name,
      color: raw.color ?? null,
    },
    update: {
      name: raw.name,
      color: raw.color ?? null,
    },
    select: { id: true },
  });
}

export async function upsertCycle(
  tx: Tx,
  projectId: string,
  raw: PlaneApiCycle,
): Promise<{ id: string }> {
  return tx.planeCycle.upsert({
    where: { projectId_externalId: { projectId, externalId: raw.id } },
    create: {
      projectId,
      externalId: raw.id,
      name: raw.name,
      startDate: raw.start_date ? new Date(raw.start_date) : null,
      endDate: raw.end_date ? new Date(raw.end_date) : null,
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    update: {
      name: raw.name,
      startDate: raw.start_date ? new Date(raw.start_date) : null,
      endDate: raw.end_date ? new Date(raw.end_date) : null,
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export async function upsertModule(
  tx: Tx,
  projectId: string,
  raw: PlaneApiModule,
): Promise<{ id: string }> {
  return tx.planeModule.upsert({
    where: { projectId_externalId: { projectId, externalId: raw.id } },
    create: {
      projectId,
      externalId: raw.id,
      name: raw.name,
      status: raw.status ?? null,
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    update: {
      name: raw.name,
      status: raw.status ?? null,
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export async function upsertWorkItem(
  tx: Tx,
  projectId: string,
  raw: PlaneApiWorkItem,
): Promise<{ id: string }> {
  // Resolve foreign-key references (state, cycle, module, parent) into our
  // local cuid PKs. Each lookup is by (projectId, externalId) — the unique
  // index means these are O(1) with the row already in pg cache.
  const [state, cycle, module, parent] = await Promise.all([
    raw.state
      ? tx.planeState.findUnique({
          where: { projectId_externalId: { projectId, externalId: raw.state } },
          select: { id: true, group: true },
        })
      : Promise.resolve(null),
    raw.cycle
      ? tx.planeCycle.findUnique({
          where: { projectId_externalId: { projectId, externalId: raw.cycle } },
          select: { id: true },
        })
      : Promise.resolve(null),
    raw.module
      ? tx.planeModule.findUnique({
          where: { projectId_externalId: { projectId, externalId: raw.module } },
          select: { id: true },
        })
      : Promise.resolve(null),
    raw.parent
      ? tx.planeWorkItem.findUnique({
          where: { projectId_externalId: { projectId, externalId: raw.parent } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  // Derive completedAt: when state.group is "completed" we trust Plane's
  // upstream `completed_at` if present; otherwise stamp now (Plane sometimes
  // omits the field). When the group flips back, clear the field.
  let completedAt: Date | null = null;
  if (state?.group === "completed") {
    completedAt = raw.completed_at ? new Date(raw.completed_at) : new Date();
  }

  const description = raw.description_markdown ?? raw.description_stripped ?? null;

  return tx.planeWorkItem.upsert({
    where: { projectId_externalId: { projectId, externalId: raw.id } },
    create: {
      projectId,
      externalId: raw.id,
      sequenceId: raw.sequence_id,
      name: raw.name,
      description,
      stateId: state?.id ?? null,
      priority: raw.priority,
      assigneeIds: raw.assignees ?? [],
      labelIds: raw.labels ?? [],
      parentId: parent?.id ?? null,
      cycleId: cycle?.id ?? null,
      moduleId: module?.id ?? null,
      startDate: raw.start_date ? new Date(raw.start_date) : null,
      targetDate: raw.target_date ? new Date(raw.target_date) : null,
      completedAt,
      externalCreatedAt: new Date(raw.created_at),
      externalUpdatedAt: new Date(raw.updated_at),
      lastSyncedAt: new Date(),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    update: {
      sequenceId: raw.sequence_id,
      name: raw.name,
      description,
      stateId: state?.id ?? null,
      priority: raw.priority,
      assigneeIds: raw.assignees ?? [],
      labelIds: raw.labels ?? [],
      parentId: parent?.id ?? null,
      cycleId: cycle?.id ?? null,
      moduleId: module?.id ?? null,
      startDate: raw.start_date ? new Date(raw.start_date) : null,
      targetDate: raw.target_date ? new Date(raw.target_date) : null,
      completedAt,
      externalUpdatedAt: new Date(raw.updated_at),
      lastSyncedAt: new Date(),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function upsertComment(
  tx: Tx,
  workItemId: string,
  raw: PlaneApiComment,
): Promise<{ id: string }> {
  const body =
    raw.comment_markdown ??
    raw.comment_stripped ??
    (typeof raw.comment_html === "string" ? stripHtml(raw.comment_html) : "");
  const authorExternalId = raw.actor_detail?.id ?? raw.actor ?? null;
  return tx.planeComment.upsert({
    where: { workItemId_externalId: { workItemId, externalId: raw.id } },
    create: {
      workItemId,
      externalId: raw.id,
      authorExternalId,
      body,
      externalCreatedAt: new Date(raw.created_at),
      externalUpdatedAt: new Date(raw.updated_at),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    update: {
      authorExternalId,
      body,
      externalUpdatedAt: new Date(raw.updated_at),
      raw: raw as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export async function upsertMember(
  tx: Tx,
  workspaceId: string,
  raw: PlaneApiMember,
): Promise<{ id: string; email: string } | null> {
  // Plane returns members in two shapes: nested under `member` (older) or
  // flattened on the row (newer). Normalize before writing.
  const externalId = raw.member?.id ?? raw.id;
  const email = raw.member?.email ?? raw.email;
  if (!externalId || !email) return null;
  const explicitName = raw.member?.display_name ?? raw.display_name ?? null;
  const composedName = [
    raw.member?.first_name ?? raw.first_name,
    raw.member?.last_name ?? raw.last_name,
  ]
    .filter(Boolean)
    .join(" ");
  const displayName = explicitName ?? (composedName.length > 0 ? composedName : email);
  const avatarUrl = raw.member?.avatar ?? raw.avatar ?? null;

  return tx.planeMember.upsert({
    where: { workspaceId_externalId: { workspaceId, externalId } },
    create: {
      workspaceId,
      externalId,
      email,
      displayName,
      avatarUrl,
    },
    update: {
      email,
      displayName,
      avatarUrl,
    },
    select: { id: true, email: true },
  });
}
