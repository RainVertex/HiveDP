import { prisma } from "@internal/db";
import { decryptSecret } from "./crypto";
import { providerKeyMissingMessage } from "./readiness";

// Resolve a provider's API key from its stored encrypted credential, or null when no key is needed.
export async function resolveProviderApiKey(args: {
  providerId: string;
  providerSlug: string;
  apiKeyEnvVar: string | null;
  isAdmin?: boolean;
}): Promise<string | null> {
  const stored = await prisma.providerCredential.findUnique({
    where: { providerId: args.providerId },
    select: { encryptedValue: true },
  });
  if (stored) return decryptSecret(stored.encryptedValue);

  // A provider that declares an apiKeyEnvVar needs a key, without a stored one it is unconfigured.
  if (args.apiKeyEnvVar) {
    throw new Error(providerKeyMissingMessage(args.isAdmin ?? false));
  }
  return null;
}
