// AES-256-GCM at-rest encryption for Integration.config secrets, keyed by INTEGRATION_SECRET_KEY (hex, 32 bytes).
// Format/key changes are breaking: rotating the key invalidates every stored secret, so coordinate with operators.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const FORMAT_VERSION = "v1";

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_SECRET_KEY is not set. Generate with `openssl rand -hex 32` and add to .env.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "INTEGRATION_SECRET_KEY must be 64 hex characters (32 bytes). Generate with `openssl rand -hex 32`.",
    );
  }
  cachedKey = Buffer.from(raw, "hex");
  if (cachedKey.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `INTEGRATION_SECRET_KEY decoded to ${cachedKey.length} bytes; expected ${KEY_LENGTH_BYTES}.`,
    );
  }
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret expects a string");
  }
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(encoded: string): string {
  if (typeof encoded !== "string") {
    throw new TypeError("decryptSecret expects a string");
  }
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Encrypted secret is malformed or uses an unsupported version.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const key = loadKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// Test seam to swap INTEGRATION_SECRET_KEY mid-process; production never calls this.
export function _resetSecretsCache(): void {
  cachedKey = null;
}
