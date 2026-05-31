// Postgres advisory locks serializing scaffold runs per target, plus stale-plan freshness checks.
import { createHash } from "node:crypto";
import { prisma } from "@internal/db";

export function lockKeyForTarget(templateId: string, targetRef: string): bigint {
  const digest = createHash("sha256").update(`${templateId} ${targetRef}`).digest();
  return digest.readBigInt64BE(0);
}

export interface TargetLockHandle {
  release(): Promise<void>;
}

export class TargetLockBusyError extends Error {
  constructor(
    public readonly templateId: string,
    public readonly targetRef: string,
  ) {
    super(`Target busy: ${templateId} :: ${targetRef}`);
    this.name = "TargetLockBusyError";
  }
}

// Advisory locks are session-scoped and Prisma multiplexes connections, so lock and unlock must share one transaction held open until release().
export async function acquireTargetLock(
  templateId: string,
  targetRef: string,
): Promise<TargetLockHandle> {
  const key = lockKeyForTarget(templateId, targetRef);

  let resolveTx: () => void = () => {};
  const txDone = new Promise<void>((res) => {
    resolveTx = res;
  });

  let acquired = false;
  let lockError: Error | null = null;

  const txPromise = prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT pg_try_advisory_lock($1::bigint) AS ok`,
      key.toString(),
    );
    acquired = rows[0]?.ok === true;
    if (!acquired) return;
    await txDone;
  });

  txPromise.catch((err) => {
    lockError = err instanceof Error ? err : new Error(String(err));
  });

  while (!acquired && lockError === null) {
    await new Promise((r) => setImmediate(r));
    if (await isSettled(txPromise)) break;
  }

  if (lockError) throw lockError;
  if (!acquired) {
    resolveTx();
    await txPromise;
    throw new TargetLockBusyError(templateId, targetRef);
  }

  return {
    release: async () => {
      resolveTx();
      await txPromise;
    },
  };
}

async function isSettled(p: Promise<unknown>): Promise<boolean> {
  return await Promise.race([
    p.then(() => true).catch(() => true),
    new Promise<boolean>((r) => setImmediate(() => r(false))),
  ]);
}

export async function ensurePlanFresh(
  bindingId: string | null,
  planCreatedAt: Date,
): Promise<{ stale: boolean; bindingUpdatedAt: Date | null }> {
  if (!bindingId) return { stale: false, bindingUpdatedAt: null };
  const binding = await prisma.scaffoldBinding.findUnique({
    where: { id: bindingId },
    select: { updatedAt: true },
  });
  if (!binding) return { stale: false, bindingUpdatedAt: null };
  return {
    stale: binding.updatedAt.getTime() > planCreatedAt.getTime(),
    bindingUpdatedAt: binding.updatedAt,
  };
}

export class StalePlanError extends Error {
  constructor(
    public readonly bindingId: string,
    public readonly bindingUpdatedAt: Date,
  ) {
    super(`Plan stale, replan required (binding ${bindingId})`);
    this.name = "StalePlanError";
  }
}
