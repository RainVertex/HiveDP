import type { RegisteredTool } from "@internal/llm-core";
import {
  createSubtask,
  listSubtasks,
  getTask,
  assignUserToTask,
  createTask,
  moveTask,
  searchTasks,
  listMyTasks,
} from "@feature/projects-backend/contract";
import { requireUserId } from "../core";

export const createSubtaskTool: RegisteredTool = {
  id: "projects_create_subtask",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_create_subtask",
      description:
        "Create one subtask under an existing parent task. The subtask inherits the parent's project and board column. Requires write access on the project. Call projects_list_subtasks first to avoid creating duplicates. Pass assignee to create and assign in one step.",
      parameters: {
        type: "object",
        properties: {
          parentTaskId: { type: "string", description: "Id of the parent task." },
          title: { type: "string", description: "Short, concrete subtask title." },
          description: {
            type: "string",
            description: "Optional one or two sentence detail for the subtask.",
          },
          assignee: {
            type: "string",
            description:
              "Optional. Name or username of the person or agent to assign this subtask to (for example a coding agent). The subtask is still created if the assignee cannot be resolved.",
          },
        },
        required: ["parentTaskId", "title"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { parentTaskId, title, description, assignee } = args as {
      parentTaskId: string;
      title: string;
      description?: string;
      assignee?: string;
    };
    const result = await createSubtask({ userId, parentTaskId, title, description });
    if ("error" in result || !assignee?.trim()) return result;
    const assignment = await assignUserToTask({
      actorUserId: userId,
      taskId: result.subtask.id,
      assignee,
    });
    return { ...result, assignment };
  },
};

export const assignTaskTool: RegisteredTool = {
  id: "projects_assign_task",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_assign_task",
      description:
        "Assign a task or subtask to a person or an agent (for example a coding agent). Resolves the assignee by name or username. If several users match, it returns the candidates so you can retry with an exact username. Assigning an agent makes that agent start working on the task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Id of the task or subtask to assign." },
          assignee: {
            type: "string",
            description: "Name or username of the person or agent to assign the task to.",
          },
        },
        required: ["taskId", "assignee"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { taskId, assignee } = args as { taskId: string; assignee: string };
    return assignUserToTask({ actorUserId: userId, taskId, assignee });
  },
};

export const listSubtasksTool: RegisteredTool = {
  id: "projects_list_subtasks",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_list_subtasks",
      description:
        "List the subtasks already created under a parent task. Call this before creating subtasks so you do not duplicate existing ones.",
      parameters: {
        type: "object",
        properties: {
          parentTaskId: { type: "string", description: "Id of the parent task." },
        },
        required: ["parentTaskId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { parentTaskId } = args as { parentTaskId: string };
    return listSubtasks({ userId, parentTaskId });
  },
};

export const getTaskTool: RegisteredTool = {
  id: "projects_get_task",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_get_task",
      description: "Fetch a single project task by id (title, description, status, project).",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Id of the task." },
        },
        required: ["taskId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { taskId } = args as { taskId: string };
    return getTask({ userId, taskId });
  },
};

export const createTaskTool: RegisteredTool = {
  id: "projects_create_task",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_create_task",
      description:
        "Create a new top-level task in a project (not a subtask). Requires write access on the project. Pass bucketId to place it in a specific board column, otherwise it lands with no column. Use projects_create_subtask instead when the work belongs under an existing parent task.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Id of the project to create the task in." },
          title: { type: "string", description: "Short, concrete task title." },
          description: {
            type: "string",
            description: "Optional one or two sentence detail for the task.",
          },
          bucketId: {
            type: "string",
            description: "Optional id of the board column (bucket) to place the task in.",
          },
        },
        required: ["projectId", "title"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { projectId, title, description, bucketId } = args as {
      projectId: string;
      title: string;
      description?: string;
      bucketId?: string;
    };
    return createTask({ userId, projectId, title, description, bucketId });
  },
};

export const moveTaskTool: RegisteredTool = {
  id: "projects_move_task",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_move_task",
      description:
        "Move a task to a different board column (bucket) and/or mark it done or not done. Requires write access. Pass bucketId to change the column and done to flip completion. The task's watchers are notified of the change.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Id of the task to move." },
          bucketId: {
            type: "string",
            description: "Optional id of the destination board column (bucket).",
          },
          done: {
            type: "boolean",
            description: "Optional. Set true to complete the task, false to reopen it.",
          },
        },
        required: ["taskId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { taskId, bucketId, done } = args as {
      taskId: string;
      bucketId?: string;
      done?: boolean;
    };
    return moveTask({ userId, taskId, bucketId, done });
  },
};

export const searchTasksTool: RegisteredTool = {
  id: "projects_search_tasks",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_search_tasks",
      description:
        "Search tasks by title and description across every project the current user can see, or one project when projectId is given. Case-insensitive substring match, up to 20 hits. Use it to find a task before acting on it.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for in task titles and descriptions.",
          },
          projectId: {
            type: "string",
            description: "Optional. Restrict the search to a single project by id.",
          },
        },
        required: ["query"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { query, projectId } = args as { query: string; projectId?: string };
    return searchTasks({ userId, query, projectId });
  },
};

export const listMyTasksTool: RegisteredTool = {
  id: "projects_list_my_tasks",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_list_my_tasks",
      description:
        "List the current user's open (not done) tasks across all projects, soonest due first. Use it to answer questions like what is assigned to me or what is due.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const userId = requireUserId(ctx);
    return listMyTasks({ userId });
  },
};
