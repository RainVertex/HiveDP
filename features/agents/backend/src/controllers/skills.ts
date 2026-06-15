import type { Request, Response } from "express";
import type { CreateSkillInput, UpdateSkillInput } from "../dto";
import * as skillsService from "../services/skills";

type IdParams = { id: string };

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await skillsService.listSkills());
}

export async function detail(req: Request<IdParams>, res: Response): Promise<void> {
  res.json(await skillsService.getSkill(req.params.id));
}

export async function create(_req: Request, res: Response): Promise<void> {
  const input = res.locals.body as CreateSkillInput;
  res.status(201).json(await skillsService.createSkill(input));
}

export async function update(req: Request<IdParams>, res: Response): Promise<void> {
  const input = res.locals.body as UpdateSkillInput;
  res.json(await skillsService.updateSkill(req.params.id, input));
}

export async function remove(req: Request<IdParams>, res: Response): Promise<void> {
  await skillsService.deleteSkill(req.params.id);
  res.status(204).end();
}
