import type { RegisteredTool } from "@internal/llm-core";
import {
  createSubtask,
  listSubtasks,
  getTask,
  assignUserToTask,
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
