// Single source of notification presentation, shared by the bell dropdown and the inbox page so the
// two never drift. The link target comes from the shared catalog; the summary copy lives in one switch.
import { hrefKindFor } from "@feature/notifications-shared";
import type { NotificationDto } from "@feature/notifications-shared";
import type { TFunction } from "i18next";

export function notificationHref(n: NotificationDto): string | null {
  const p = n.payload as Record<string, unknown>;
  switch (hrefKindFor(n.kind)) {
    case "task":
      return typeof p.taskId === "string" ? `/tasks/${p.taskId}` : "/projects";
    case "project":
      return typeof p.projectId === "string" ? `/projects/${p.projectId}` : "/projects";
    case "team":
      return typeof p.teamSlug === "string" ? `/teams/${p.teamSlug}` : "/teams";
    default:
      return null;
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function notificationSummary(n: NotificationDto, t: TFunction): string {
  const p = n.payload as Record<string, unknown>;
  const taskTitle = () => str(p.taskTitle, t("fallback.aTask"));
  const author = () => str(p.authorName, t("fallback.someone"));

  switch (n.kind) {
    case "projects.task.assigned": {
      const title = taskTitle();
      const project = typeof p.projectTitle === "string" ? p.projectTitle : null;
      return project
        ? t("summary.taskAssignedInProject", { title, project })
        : t("summary.taskAssigned", { title });
    }
    case "projects.task.updated": {
      const title = taskTitle();
      const changes = (p.changes ?? {}) as Record<string, { to?: unknown }>;
      if (changes.done) {
        return changes.done.to
          ? t("summary.taskCompleted", { title })
          : t("summary.taskReopened", { title });
      }
      if (changes.bucket) return t("summary.taskMoved", { title });
      if (changes.dueDate) return t("summary.taskDueChanged", { title });
      if (changes.priority) return t("summary.taskPriorityChanged", { title });
      return t("summary.taskUpdated", { title });
    }
    case "projects.task.unassigned":
      return t("summary.taskUnassigned", { title: taskTitle() });
    case "projects.task.commentAdded":
      return t("summary.taskCommented", { author: author(), title: taskTitle() });
    case "projects.task.mentioned":
      return t("summary.taskMentioned", { author: author(), title: taskTitle() });
    case "projects.task.dueSoon":
      return t("summary.taskDueSoon", { title: taskTitle() });
    case "projects.coding.completed":
      return t("summary.codingCompleted", {
        project: str(p.projectTitle, t("fallback.aProject")),
        summary: str(p.summary, ""),
      });
    case "projects.member.added":
      return t("summary.projectMemberAdded", {
        project: str(p.projectTitle, t("fallback.aProject")),
      });
    case "projects.member.removed":
      return t("summary.projectMemberRemoved", {
        project: str(p.projectTitle, t("fallback.aProject")),
      });
    case "projects.member.permissionChanged":
      return t("summary.projectPermissionChanged", {
        project: str(p.projectTitle, t("fallback.aProject")),
      });
    case "team.member.added":
      return t("summary.memberAdded");
    case "team.member.removed":
      return t("summary.memberRemoved");
    case "team.member.roleChanged":
      return t("summary.teamRoleChanged", { role: str(p.after, t("fallback.aRole")) });
    case "team.updated":
      return t("summary.teamUpdated", { team: str(p.teamName, t("fallback.aTeam")) });
    case "team.deleted":
      return t("summary.teamDeleted", { team: str(p.teamName, t("fallback.aTeam")) });
    case "team.ownershipTransferred":
      return t("summary.teamOwnershipTransferred", {
        from: str(p.fromTeamName, t("fallback.aTeam")),
        to: str(p.toTeamName, t("fallback.aTeam")),
      });
    case "scaffolder.run.succeeded":
      return t("summary.scaffolderSucceeded", {
        template: str(p.templateId, t("fallback.aTemplate")),
      });
    case "scaffolder.run.failed":
      return t("summary.scaffolderFailed", {
        template: str(p.templateId, t("fallback.aTemplate")),
      });
    case "catalog.entity.ownershipChanged":
      return t("summary.catalogOwnershipChanged", {
        entity: str(p.entityName, t("fallback.anEntity")),
      });
    case "grafana.alert":
      return t("summary.grafanaAlert", { alert: str(p.alertname, t("fallback.anAlert")) });
    case "grafana.alert.resolved":
      return t("summary.grafanaAlertResolved", { alert: str(p.alertname, t("fallback.anAlert")) });
    default:
      return n.kind;
  }
}
