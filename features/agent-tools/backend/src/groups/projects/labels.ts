import type { RegisteredTool } from "@internal/llm-core";
import { listProjectLabels, setTaskLabels } from "@feature/projects-backend/contract";
import { requireUserId } from "../core";

export const listLabelsTool: RegisteredTool = {
  id: "projects_list_labels",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_list_labels",
      description:
        "List the labels defined in a project (title and color). Call this before projects_set_labels so you use titles that actually exist.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Id of the project." },
        },
        required: ["projectId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { projectId } = args as { projectId: string };
    return listProjectLabels({ userId, projectId });
  },
};

export const setLabelsTool: RegisteredTool = {
  id: "projects_set_labels",
  openaiDef: {
    type: "function",
    function: {
      name: "projects_set_labels",
      description:
        "Set the exact list of labels on a task, by label title. Replaces any labels already on the task. Titles are matched against the project's labels case-insensitively, titles that do not exist come back in `unresolved` (this never creates new labels). Call projects_list_labels first to learn the available titles.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Id of the task." },
          labels: {
            type: "array",
            items: { type: "string" },
            description:
              "The full set of label titles the task should have. Pass an empty array to clear all labels.",
          },
        },
        required: ["taskId", "labels"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    const { taskId, labels } = args as { taskId: string; labels: string[] };
    return setTaskLabels({ userId, taskId, labels });
  },
};
