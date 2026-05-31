// Generic key/value system settings backed by the SystemSetting table.

import { prisma, Prisma } from "@internal/db";

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

export async function setSetting(
  key: string,
  value: unknown,
  updatedByUserId?: string | null,
): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: json, updatedByUserId: updatedByUserId ?? null },
    create: { key, value: json, updatedByUserId: updatedByUserId ?? null },
  });
}

// Unsets a value without storing JSON null, so getSetting returns null afterward.
export async function clearSetting(key: string): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } });
}
