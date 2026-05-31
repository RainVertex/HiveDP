// Drag-and-drop kanban board: maps tasks into bucket columns and persists moves.
import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  useBuckets,
  useUpdateTask,
  useCreateBucket,
  useUpdateBucket,
  useDeleteBucket,
  useCreateTask,
  type Bucket,
  type Task,
} from "./api";
import { TaskCard, SortableTaskCard } from "./components/TaskCard";

const FALLBACK_BUCKET_ID = "__all__";

function DroppableBucketBody({
  bucketId,
  children,
}: {
  bucketId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket-${bucketId}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-2 p-2 min-h-[6rem] ${isOver ? "bg-app-surface-hover" : ""}`}
    >
      {children}
    </div>
  );
}

interface BoardBucket extends Bucket {
  tasks: Task[];
}

interface Props {
  projectId: string;
  tasks: Task[];
  onUpdate: () => void;
  canEdit?: boolean;
}

export function KanbanBoard({ projectId, tasks, onUpdate, canEdit = true }: Props) {
  const { buckets: apiBuckets, loading, error, refetch: refetchBuckets } = useBuckets(projectId);
  const { update } = useUpdateTask();
  const { create: createBucket } = useCreateBucket(projectId);
  const { update: updateBucket } = useUpdateBucket();
  const { remove: deleteBucket } = useDeleteBucket();
  const { create: createTask } = useCreateTask(projectId);
  const [buckets, setBuckets] = useState<BoardBucket[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [newBucketTitle, setNewBucketTitle] = useState("");
  const [showNewBucket, setShowNewBucket] = useState(false);
  const [editingBucket, setEditingBucket] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [newTaskBucket, setNewTaskBucket] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (apiBuckets.length === 0 && tasks.length > 0) {
      setBuckets([
        {
          id: FALLBACK_BUCKET_ID,
          projectId,
          title: "All Tasks",
          position: 0,
          taskLimit: null,
          tasks,
        },
      ]);
      return;
    }
    const tasksByBucket = new Map<string, Task[]>();
    const unassigned: Task[] = [];
    for (const t of tasks) {
      if (t.bucketId) {
        const list = tasksByBucket.get(t.bucketId) ?? [];
        list.push(t);
        tasksByBucket.set(t.bucketId, list);
      } else {
        unassigned.push(t);
      }
    }
    const sorted = apiBuckets.slice().sort((a, b) => a.position - b.position);
    const first = sorted[0];
    const boards: BoardBucket[] = sorted.map((b) => ({
      ...b,
      tasks: [...(tasksByBucket.get(b.id) ?? []), ...(b === first ? unassigned : [])],
    }));
    setBuckets(boards);
  }, [apiBuckets, tasks, projectId]);

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => String(t.id) === String(event.active.id));
    setActiveTask(task ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);

    let targetBucketId: string | null = null;
    const droppableMatch = /^bucket-(.+)$/.exec(overId);
    if (droppableMatch) {
      targetBucketId = droppableMatch[1];
    } else {
      for (const b of buckets) {
        if (b.id === overId) {
          targetBucketId = b.id;
          break;
        }
        if (b.tasks.some((t) => t.id === overId)) {
          targetBucketId = b.id;
          break;
        }
      }
    }

    if (targetBucketId === null || targetBucketId === FALLBACK_BUCKET_ID) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.bucketId === targetBucketId) return;

    try {
      await update(taskId, { bucketId: targetBucketId });
      onUpdate();
      refetchBuckets();
    } catch {
      // error handled by hook
    }
  }

  async function handleAddBucket(e: React.FormEvent) {
    e.preventDefault();
    if (!newBucketTitle.trim()) return;
    try {
      await createBucket(newBucketTitle.trim());
      setNewBucketTitle("");
      setShowNewBucket(false);
      refetchBuckets();
    } catch {
      // ignore
    }
  }

  function startRename(bucket: BoardBucket) {
    setEditingBucket(bucket.id);
    setEditingTitle(bucket.title);
  }

  async function commitRename(bucket: BoardBucket) {
    if (!editingTitle.trim() || editingTitle === bucket.title) {
      setEditingBucket(null);
      return;
    }
    if (bucket.id === FALLBACK_BUCKET_ID) {
      setEditingBucket(null);
      return;
    }
    try {
      await updateBucket(bucket.id, { title: editingTitle.trim() });
      refetchBuckets();
    } catch {
      // ignore
    } finally {
      setEditingBucket(null);
    }
  }

  async function handleDeleteBucket(bucket: BoardBucket) {
    if (bucket.id === FALLBACK_BUCKET_ID) return;
    if (!confirm(`Delete column "${bucket.title}"? Tasks will not be deleted.`)) return;
    try {
      await deleteBucket(bucket.id);
      refetchBuckets();
      onUpdate();
    } catch {
      // ignore
    }
  }

  async function handleAddTask(bucketId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    try {
      await createTask({ title: newTaskTitle.trim(), bucketId });
      setNewTaskTitle("");
      setNewTaskBucket(null);
      onUpdate();
    } catch {
      // ignore
    }
  }

  if (loading) return <p className="text-sm text-app-text-muted">Loading board...</p>;
  if (error) {
    return (
      <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
        {error}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {buckets.map((bucket) => (
          <div
            key={bucket.id}
            className="flex w-72 shrink-0 flex-col rounded-lg border border-app-border bg-app-surface"
          >
            <div className="flex items-center justify-between border-b border-app-border px-3 py-2">
              {editingBucket === bucket.id ? (
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => void commitRename(bucket)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(bucket);
                    if (e.key === "Escape") setEditingBucket(null);
                  }}
                  autoFocus
                  className="flex-1 rounded border border-app-border bg-app-surface px-2 py-0.5 text-sm text-app-text"
                />
              ) : (
                <h3
                  className="flex-1 cursor-text text-sm font-medium text-app-text"
                  onDoubleClick={() =>
                    canEdit && bucket.id !== FALLBACK_BUCKET_ID && startRename(bucket)
                  }
                  title={canEdit ? "Double-click to rename" : undefined}
                >
                  {bucket.title}
                </h3>
              )}
              <span className="ml-2 text-xs text-app-text-muted">{bucket.tasks.length}</span>
              {canEdit && bucket.id !== FALLBACK_BUCKET_ID && (
                <button
                  type="button"
                  onClick={() => void handleDeleteBucket(bucket)}
                  className="ml-2 text-xs text-app-danger hover:opacity-80"
                  title="Delete column"
                >
                  ×
                </button>
              )}
            </div>
            <SortableContext
              items={bucket.tasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
              id={bucket.id}
            >
              <DroppableBucketBody bucketId={bucket.id}>
                {bucket.tasks.map((task) => (
                  <SortableTaskCard key={task.id} task={task} />
                ))}
              </DroppableBucketBody>
            </SortableContext>
            {canEdit && bucket.id !== FALLBACK_BUCKET_ID && (
              <div className="border-t border-app-border p-2">
                {newTaskBucket === bucket.id ? (
                  <form onSubmit={(e) => void handleAddTask(bucket.id, e)} className="flex gap-1">
                    <input
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="Task title"
                      autoFocus
                      className="flex-1 rounded border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text"
                    />
                    <button
                      type="submit"
                      className="rounded bg-app-primary px-2 py-1 text-xs text-app-primary-on"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewTaskBucket(null);
                        setNewTaskTitle("");
                      }}
                      className="rounded border border-app-border px-2 py-1 text-xs text-app-text"
                    >
                      ×
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNewTaskBucket(bucket.id)}
                    className="w-full rounded px-2 py-1 text-left text-xs text-app-text-muted hover:bg-app-surface-hover"
                  >
                    + Add task
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex w-72 shrink-0 flex-col items-stretch justify-start">
            {showNewBucket ? (
              <form
                onSubmit={handleAddBucket}
                className="rounded-lg border border-app-border bg-app-surface p-3"
              >
                <input
                  type="text"
                  value={newBucketTitle}
                  onChange={(e) => setNewBucketTitle(e.target.value)}
                  placeholder="Column name"
                  autoFocus
                  className="w-full rounded border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="submit"
                    disabled={!newBucketTitle.trim()}
                    className="rounded bg-app-primary px-3 py-1 text-xs text-app-primary-on hover:opacity-90 disabled:opacity-60"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewBucket(false);
                      setNewBucketTitle("");
                    }}
                    className="rounded border border-app-border px-3 py-1 text-xs text-app-text"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewBucket(true)}
                className="rounded-lg border border-dashed border-app-border px-3 py-2 text-sm text-app-text-muted hover:bg-app-surface-hover"
              >
                + Add Column
              </button>
            )}
          </div>
        )}
      </div>
      <DragOverlay>{activeTask ? <TaskCard task={activeTask} /> : null}</DragOverlay>
    </DndContext>
  );
}
