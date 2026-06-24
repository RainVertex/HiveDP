import { projectsDb } from "@internal/db";
import { meetsLevel, resolveAccess } from "./permissions";
import { userSummary, type UserSummaryDto } from "./dto";
import { notifyTaskAssigned } from "./notifications";
import { triggerAgentRunForTask } from "./agentRuns";

// Assigning a user to a task, shared by the HTTP assignee endpoint and the planner's assign tool.
// A user is assignable if they are a human or an agent whose backing agent has assignableToTasks set.
// Assigning an agent kicks off a run against the task (it reports back as a comment); assigning a
// human notifies them. The actor needs WRITE on the task's project.

export type AssignableUser = { id: string; username: string; name: string; kind: string };

type ResolvedUser = { id: string; githubLogin: string; displayName: string; userKind: string };

export type AssignOutcome =
  | { ok: true; user: UserSummaryDto }
  | {
      ok: false;
      reason: "task_not_found" | "forbidden" | "not_found" | "ambiguous" | "not_assignable";
      error: string;
      candidates?: AssignableUser[];
    };

export async function searchAssignableUsers(query: string): Promise<AssignableUser[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const users = await projectsDb.user.findMany({
    where: {
      OR: [{ userKind: "human" }, { userKind: "agent", backedAgent: { assignableToTasks: true } }],
      AND: [
        {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { githubLogin: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
      ],
    },
    orderBy: { displayName: "asc" },
    take: 20,
  });
  return users.map((u) => ({
    id: u.id,
    username: u.githubLogin,
    name: u.displayName,
    kind: u.userKind,
  }));
}

function isAssignable(u: {
  userKind: string;
  backedAgent?: { assignableToTasks: boolean } | null;
}): boolean {
  return (
    u.userKind === "human" || (u.userKind === "agent" && Boolean(u.backedAgent?.assignableToTasks))
  );
}

// Exact githubLogin first (the picker sends a login), else a name/login/email search restricted to
// assignable users. Returns the lone match, or an ambiguity error carrying the candidates to retry with.
async function resolveAssignee(
  assignee: string,
): Promise<{ ok: true; user: ResolvedUser } | Extract<AssignOutcome, { ok: false }>> {
  const q = assignee.trim();
  if (!q) return { ok: false, reason: "not_found", error: "No assignee provided" };

  const exact = await projectsDb.user.findUnique({
    where: { githubLogin: q },
    include: { backedAgent: { select: { assignableToTasks: true } } },
  });
  if (exact) {
    if (!isAssignable(exact)) {
      return {
        ok: false,
        reason: "not_assignable",
        error: `"${exact.displayName}" is not assignable to tasks`,
      };
    }
    return { ok: true, user: exact };
  }

  const matches = await searchAssignableUsers(q);
  if (matches.length === 0) {
    return { ok: false, reason: "not_found", error: `No assignable user found matching "${q}"` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      error: `Multiple users match "${q}", assign one by their exact username`,
      candidates: matches,
    };
  }
  const user = await projectsDb.user.findUnique({ where: { id: matches[0].id } });
  if (!user)
    return { ok: false, reason: "not_found", error: `No assignable user found matching "${q}"` };
  return { ok: true, user };
}

export async function assignUserToTask(input: {
  actorUserId: string;
  taskId: string;
  assignee: string;
}): Promise<AssignOutcome> {
  const task = await projectsDb.task.findUnique({
    where: { id: input.taskId },
    include: { project: { select: { id: true, title: true } } },
  });
  if (!task) return { ok: false, reason: "task_not_found", error: "Task not found" };

  const access = await resolveAccess(input.actorUserId, task.projectId);
  if (!access) return { ok: false, reason: "task_not_found", error: "Task not found" };
  if (!meetsLevel(access, "write")) {
    return { ok: false, reason: "forbidden", error: "Write permission required" };
  }

  const resolved = await resolveAssignee(input.assignee);
  if (!resolved.ok) return resolved;
  const target = resolved.user;

  const existed = await projectsDb.taskAssignee.findUnique({
    where: { taskId_userId: { taskId: task.id, userId: target.id } },
    select: { taskId: true },
  });
  if (!existed) {
    await projectsDb.taskAssignee.create({
      data: { taskId: task.id, userId: target.id, assignedByUserId: input.actorUserId },
    });
    if (target.userKind === "agent") {
      triggerAgentRunForTask({ agentUserId: target.id, taskId: task.id });
    } else if (target.id !== input.actorUserId) {
      await notifyTaskAssigned({
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.project.id,
        projectTitle: task.project.title,
        recipientUserId: target.id,
      });
    }
  }
  return { ok: true, user: userSummary(target)! };
}
