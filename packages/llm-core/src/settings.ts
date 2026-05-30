import { prisma, Prisma } from "@internal/db";

// Generic key/value system settings backed by the SystemSetting table. Reads
// return null when the key is unset so callers decide the default.

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

// Remove a setting entirely. getSetting then returns null. Used to "unset" a
// value (e.g. clearing the active chat model) without storing JSON null.
export async function clearSetting(key: string): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } });
}
