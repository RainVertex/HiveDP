import type { Request, Response } from "express";
import * as modelsService from "../services/models";

export async function models(_req: Request, res: Response): Promise<void> {
  res.json({ items: await modelsService.listModels() });
}

export async function recommendations(req: Request, res: Response): Promise<void> {
  const kind = typeof req.query.kind === "string" ? req.query.kind : "custom";
  const runtime = typeof req.query.runtime === "string" ? req.query.runtime : undefined;
  res.json(await modelsService.recommendations(kind, runtime));
}
