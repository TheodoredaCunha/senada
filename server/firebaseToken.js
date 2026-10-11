import crypto from "node:crypto";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedKeys = { keys: new Map(), expiresAt: 0 };

async function getSigningKey(kid) {
  if (Date.now() >= cachedKeys.expiresAt || !cachedKeys.keys.has(kid)) {
    const response = await fetch(JWKS_URL);
    if (!response.ok) throw new Error("Unable to load Firebase signing keys.");
    const { keys } = await response.json();
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") || "")?.[1] || 3600);
    cachedKeys = {
      keys: new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" })])),
      expiresAt: Date.now() + maxAge * 1000,
    };
  }
  const key = cachedKeys.keys.get(kid);
  if (!key) throw new Error("Unknown Firebase signing key.");
  return key;
}

const decodePart = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

// Verifies a Firebase ID token per Firebase's documented rules and returns its claims.
export async function verifyFirebaseIdToken(idToken, projectId) {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured.");
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3) throw new Error("Malformed ID token.");

  const header = decodePart(parts[0]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported ID token.");

  const key = await getSigningKey(header.kid);
  const validSignature = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!validSignature) throw new Error("Invalid ID token signature.");

  const claims = decodePart(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("ID token is for a different Firebase project.");
  }
  if (!claims.sub || claims.exp <= now || claims.iat > now + 60) throw new Error("ID token is expired or not yet valid.");
  return claims;
}
