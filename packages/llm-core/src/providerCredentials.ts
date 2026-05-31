import { prisma } from "@internal/db";
import { encryptSecret } from "./crypto";

// Admin-managed provider API keys stored encrypted at rest; plaintext is never returned to clients.

export async function getProviderIdsWithStoredKey(): Promise<Set<string>> {
  const rows = await prisma.providerCredential.findMany({ select: { providerId: true } });
  return new Set(rows.map((r) => r.providerId));
}

export async function providerHasStoredKey(providerId: string): Promise<boolean> {
  const row = await prisma.providerCredential.findUnique({
    where: { providerId },
    select: { providerId: true },
  });
  return Boolean(row);
}

export async function setProviderKey(
  providerId: string,
  apiKey: string,
  updatedByUserId?: string | null,
): Promise<void> {
  // Plain ArrayBuffer-backed Uint8Array is required by the Prisma Bytes field.
  const encryptedValue = new Uint8Array(encryptSecret(apiKey));
  await prisma.providerCredential.upsert({
    where: { providerId },
    update: { encryptedValue, updatedByUserId: updatedByUserId ?? null },
    create: { providerId, encryptedValue, updatedByUserId: updatedByUserId ?? null },
  });
}

export async function clearProviderKey(providerId: string): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { providerId } });
}
