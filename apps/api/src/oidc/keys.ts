import { generateKeyPair, exportJWK, type CryptoKey, type KeyObject, type JWK } from "jose";

type SigningKey = CryptoKey | KeyObject;

let privateKey: SigningKey;
let publicJwk: JWK;
let ready: Promise<void> | null = null;

const KID = "platform-oidc-1";

async function init() {
  const { privateKey: priv, publicKey: pub } = await generateKeyPair("RS256");
  privateKey = priv;
  const jwk = await exportJWK(pub);
  jwk.kid = KID;
  jwk.use = "sig";
  jwk.alg = "RS256";
  publicJwk = jwk;
}

export async function ensureKeys() {
  if (!ready) ready = init();
  await ready;
}

export function getPrivateKey(): SigningKey {
  return privateKey;
}

export function getJwks() {
  return { keys: [publicJwk] };
}

export function getKid(): string {
  return KID;
}
