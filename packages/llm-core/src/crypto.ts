import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM secret encryption at rest; blob layout is iv(12) | ciphertext | tag(16).

// Master key is validated lazily so servers without APP_SECRET_MASTER_KEY can still boot.
const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedMasterKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = process.env.APP_SECRET_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "APP_SECRET_MASTER_KEY is not set. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else {
    buf = Buffer.from(raw, "base64");
  }
  if (buf.length !== 32) {
    throw new Error("APP_SECRET_MASTER_KEY must decode to 32 bytes (hex or base64)");
  }
  cachedMasterKey = buf;
  return buf;
}

export function encryptSecret(plain: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

export function decryptSecret(blob: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(blob)
    ? blob
    : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("Secret blob too short — corrupt or wrong format");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
