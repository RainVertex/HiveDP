// SSRF guard rejecting admin Grafana baseUrls that resolve to private/loopback addresses.
// TOCTOU caveat: address is checked at connect time only, a malicious DNS could flip it later.

import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";

const PRIVATE_V4: RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
];

function isPrivateV6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1") return true;
  if (a.startsWith("fc") || a.startsWith("fd")) return true;
  if (a.startsWith("fe80")) return true;
  return false;
}

export class PrivateBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateBaseUrlError";
  }
}

// Throws PrivateBaseUrlError on private hosts unless ALLOW_PRIVATE_GRAFANA_BASEURL=true; no-op on parse/resolve failure.
export async function assertNonPrivateHost(baseUrl: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_GRAFANA_BASEURL === "true") return;

  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return;
  }
  if (!host) return;

  let records: LookupAddress[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    // Let the downstream fetch surface the DNS error verbatim instead of masking it.
    return;
  }

  for (const r of records) {
    if (r.family === 4 && PRIVATE_V4.some((re) => re.test(r.address))) {
      throw new PrivateBaseUrlError(
        `baseUrl ${baseUrl} resolves to private IPv4 ${r.address}; set ALLOW_PRIVATE_GRAFANA_BASEURL=true to allow.`,
      );
    }
    if (r.family === 6 && isPrivateV6(r.address)) {
      throw new PrivateBaseUrlError(
        `baseUrl ${baseUrl} resolves to private IPv6 ${r.address}; set ALLOW_PRIVATE_GRAFANA_BASEURL=true to allow.`,
      );
    }
  }
}
