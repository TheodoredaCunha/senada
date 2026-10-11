import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./db.js";

function loadKey() {
  const configured = process.env.TOKEN_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
    }
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("TOKEN_ENCRYPTION_KEY is required in production.");
  }
  // Development only: a generated key kept next to the (gitignored) database.
  const keyFile = path.join(dataDir, "dev-token.key");
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "base64");
}

const key = loadKey();

export function encryptToken(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

// Returns null when the value is missing or can't be decrypted (e.g. the key changed).
export function decryptToken(stored) {
  if (!stored || !stored.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(stored.slice(3), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
