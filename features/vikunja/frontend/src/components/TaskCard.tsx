import { Link } from "react-router-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { VikunjaTask } from "../api";

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-gray-600",
  1: "bg-blue-600",
  2: "bg-yellow-600",
  3: "bg-orange-600",
  4: "bg-red-600",
};

const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Med",
  3: "High",
  4: "Urg",
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface TaskCardProps {
  task: VikunjaTask;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="rounded-md border border-app-border bg-app-surface p-3 shadow-sm">
      <Link
        to={`/vikunja/tasks/${task.id}`}
        className="text-sm font-medium text-app-text hover:underline"
      >
        {task.title}
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] text-white ${PRIORITY_COLORS[task.priority] ?? "bg-gray-600"}`}
        >
          {PRIORITY_LABELS[task.priority] ?? "None"}
        </span>
        {task.assignees?.map((a) => (
          <span
            key={a.id}
            title={a.name || a.username}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-app-primary/30 text-[9px] font-medium text-app-text"
          >
            {getInitials(a.name || a.username)}
          </span>
        ))}
        {task.due_date && (
          <span className="ml-auto text-[10px] text-app-text-muted">
            {new Date(task.due_date).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

export function SortableTaskCard({ task }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} />
    </div>
  );
}
