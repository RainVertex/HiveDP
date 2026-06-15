import { Router } from "express";
import * as skills from "../controllers/skills";
import { agentsErrorHandler } from "../errors";
import { createSkillSchema, updateSkillSchema } from "../dto";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";

export const skillsRouter: Router = Router();

skillsRouter.get("/", requireAuth, skills.list);
skillsRouter.get("/:id", requireAuth, skills.detail);
skillsRouter.post(
  "/",
  requireAdmin("Only admins can create skills"),
  validateBody(createSkillSchema),
  skills.create,
);
skillsRouter.patch(
  "/:id",
  requireAdmin("Only admins can edit skills"),
  validateBody(updateSkillSchema),
  skills.update,
);
skillsRouter.delete("/:id", requireAdmin("Only admins can delete skills"), skills.remove);

skillsRouter.use(agentsErrorHandler);
