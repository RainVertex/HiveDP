import { join } from "node:path";

// Skeletons sit one level above __dirname, which is dist/ after build and src/ under tsx.
export const skeletonsRoot: string = join(__dirname, "..", "skeletons");

export function skeletonPath(templateId: string): string {
  return join(skeletonsRoot, templateId);
}
