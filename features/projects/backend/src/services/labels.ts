import { projectsDb } from "@internal/db";
import { meetsLevel, resolveAccess } from "./permissions";
import { labelDto, taskDto, TASK_INCLUDE, type LabelDto, type TaskDto } from "./dto";

type LabelsResult = { labels: LabelDto[] } | { error: string };
type SetLabelsResult = { task: TaskDto; unresolved: string[] } | { error: string };

export async function listProjectLabels(input: {
  userId: string;
  projectId: string;
}): Promise<LabelsResult> {
  const access = await resolveAccess(input.userId, input.projectId);
  if (!access) return { error: "Project not found" };
  const labels = await projectsDb.label.findMany({
    where: { projectId: input.projectId },
    orderBy: { title: "asc" },
  });
  return { labels: labels.map(labelDto) };
}

// Replaces a task's labels with the ones named in `labels` (matched by title within the task's
// project, case-insensitively). Titles that do not match an existing project label come back in
// `unresolved` so the model can report or create them, this never invents new labels.
export async function setTaskLabels(input: {
  userId: string;
  taskId: string;
  labels: string[];
}): Promise<SetLabelsResult> {
  const task = await projectsDb.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, projectId: true },
  });
  if (!task) return { error: "Task not found" };

  const access = await resolveAccess(input.userId, task.projectId);
  if (!access) return { error: "Task not found" };
  if (!meetsLevel(access, "write")) return { error: "Write permission required" };

  const wanted = [...new Set(input.labels.map((l) => l.trim()).filter(Boolean))];
  const all = await projectsDb.label.findMany({
    where: { projectId: task.projectId },
    select: { id: true, title: true },
  });
  const byTitle = new Map(all.map((l) => [l.title.toLowerCase(), l]));

  const matched: { id: string; title: string }[] = [];
  const unresolved: string[] = [];
  for (const w of wanted) {
    const hit = byTitle.get(w.toLowerCase());
    if (hit) matched.push(hit);
    else unresolved.push(w);
  }

  await projectsDb.$transaction(async (tx) => {
    await tx.taskLabel.deleteMany({ where: { taskId: task.id } });
    if (matched.length > 0) {
      await tx.taskLabel.createMany({
        data: matched.map((l) => ({ taskId: task.id, labelId: l.id })),
        skipDuplicates: true,
      });
    }
  });

  const updated = await projectsDb.task.findUnique({
    where: { id: task.id },
    include: TASK_INCLUDE,
  });
  return { task: taskDto(updated!), unresolved };
}
