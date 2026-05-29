import { Router } from "express";
import express from "express";
import { SignJWT, jwtVerify, importJWK, type CryptoKey, type KeyObject } from "jose";
import { ensureKeys, getJwks, getKid, getPrivateKey } from "./keys";
import { consumeCode, issueCode } from "./codes";
import { readSessionCookie, validateSession } from "../auth/session";
import { loadEnv } from "../config/env";
import { prisma } from "@internal/db";

const OIDC_CLIENT_ID = process.env.VIKUNJA_OIDC_CLIENT_ID ?? "platform-vikunja";
const OIDC_CLIENT_SECRET = process.env.VIKUNJA_OIDC_CLIENT_SECRET ?? "vikunja-dev-oidc-secret";

export const oidcRouter = Router();

oidcRouter.use("/oidc/token", express.urlencoded({ extended: false }));

function issuer(): string {
  return process.env.OIDC_ISSUER ?? `http://localhost:${loadEnv().port}`;
}

oidcRouter.get("/.well-known/openid-configuration", (_req, res) => {
  const iss = issuer();
  const browserOrigin = loadEnv().webOrigin;
  res.json({
    issuer: iss,
    authorization_endpoint: `${browserOrigin}/oidc/auth`,
    token_endpoint: `${iss}/oidc/token`,
    userinfo_endpoint: `${iss}/oidc/userinfo`,
    jwks_uri: `${iss}/oidc/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    claims_supported: ["sub", "email", "name", "preferred_username", "picture"],
    grant_types_supported: ["authorization_code"],
  });
});

oidcRouter.get("/oidc/jwks", async (_req, res) => {
  await ensureKeys();
  res.json(getJwks());
});

oidcRouter.get("/oidc/auth", async (req, res) => {
  const clientId = req.query.client_id as string;
  const redirectUri = req.query.redirect_uri as string;
  const state = req.query.state as string | undefined;

  if (clientId !== OIDC_CLIENT_ID) {
    res.status(400).json({ error: "unknown client_id" });
    return;
  }

  const raw = readSessionCookie(req);
  const user = await validateSession(raw);
  if (!user) {
    const loginUrl = `${loadEnv().webOrigin}/login?returnTo=${encodeURIComponent(req.originalUrl)}`;
    res.redirect(loginUrl);
    return;
  }

  const code = issueCode({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    githubLogin: user.githubLogin,
    clientId,
    redirectUri,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

oidcRouter.post("/oidc/token", async (req, res) => {
  await ensureKeys();

  const grantType = req.body.grant_type;
  if (grantType !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }

  let clientId = req.body.client_id;
  let clientSecret = req.body.client_secret;
  const code = req.body.code as string;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const sep = decoded.indexOf(":");
    clientId = decoded.slice(0, sep);
    clientSecret = decoded.slice(sep + 1);
  }

  if (clientId !== OIDC_CLIENT_ID || clientSecret !== OIDC_CLIENT_SECRET) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }

  const entry = consumeCode(code, clientId);
  if (!entry) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }

  const iss = issuer();
  const now = Math.floor(Date.now() / 1000);

  const idToken = await new SignJWT({
    sub: entry.userId,
    email: entry.email,
    name: entry.displayName,
    preferred_username: entry.githubLogin,
    picture: entry.avatarUrl ?? undefined,
  })
    .setProtectedHeader({ alg: "RS256", kid: getKid() })
    .setIssuer(iss)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(getPrivateKey());

  const accessToken = await new SignJWT({ sub: entry.userId })
    .setProtectedHeader({ alg: "RS256", kid: getKid() })
    .setIssuer(iss)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(getPrivateKey());

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    id_token: idToken,
  });
});

oidcRouter.get("/oidc/userinfo", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  try {
    await ensureKeys();
    const jwks = getJwks();
    const key = await importJWK(jwks.keys[0], "RS256");
    const token = auth.slice(7);
    const { payload } = await jwtVerify(token, key as CryptoKey | KeyObject);

    const user = await prisma.user.findUnique({ where: { id: payload.sub! } });
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }

    res.json({
      sub: user.id,
      email: user.email,
      name: user.displayName,
      preferred_username: user.githubLogin,
      picture: user.avatarUrl,
    });
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
});
