import { db, newId, PROVIDERS } from "./db.js";
import { decryptToken, encryptToken } from "./tokenCrypto.js";

// Working copy of each user's provider tokens; the database row is the source of truth across restarts.
const cache = new Map();
const cacheKey = (userId, provider) => `${userId}:${provider}`;

function loadConnection(userId, provider) {
  return db.prepare("SELECT * FROM provider_connections WHERE user_id = ? AND provider = ?").get(userId, provider);
}

function bind(session, userId, provider) {
  Object.defineProperty(session, "binding", { value: { userId, provider }, enumerable: false });
  return session;
}

export function getProviderSession(user, provider) {
  // Unauthenticated callers get a throwaway object; route guards reject them before it matters.
  if (!user) return {};
  const key = cacheKey(user.id, provider);
  let session = cache.get(key);
  if (session) return session;

  session = bind({ createdAt: Date.now() }, user.id, provider);
  const row = loadConnection(user.id, provider);
  if (row?.status === "connected") {
    const accessToken = decryptToken(row.access_token);
    if (accessToken) {
      session.access_token = accessToken;
      session.refresh_token = decryptToken(row.refresh_token);
      session.expires_at = row.expires_at;
      session.user = row.profile ? JSON.parse(row.profile) : null;
    }
  }
  cache.set(key, session);
  return session;
}

// Saves the session's tokens, or flags the connection for reconnecting when it no longer has any.
export function persistProviderSession(session) {
  const binding = session.binding;
  if (!binding) return;
  const { userId, provider } = binding;
  const now = Date.now();

  if (!session.access_token) {
    db.prepare(`UPDATE provider_connections
      SET access_token = NULL, refresh_token = NULL, expires_at = NULL, status = 'needs_reconnect', updated_at = ?
      WHERE user_id = ? AND provider = ?`).run(now, userId, provider);
    return;
  }

  db.prepare(`INSERT INTO provider_connections
      (id, user_id, provider, provider_user_id, access_token, refresh_token, expires_at, status, profile, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?)
    ON CONFLICT (user_id, provider) DO UPDATE SET
      provider_user_id = excluded.provider_user_id,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, provider_connections.refresh_token),
      expires_at = excluded.expires_at,
      status = 'connected',
      profile = excluded.profile,
      updated_at = excluded.updated_at`).run(
    newId(),
    userId,
    provider,
    session.user?.id != null ? String(session.user.id) : null,
    encryptToken(session.access_token),
    encryptToken(session.refresh_token),
    session.expires_at ?? null,
    session.user ? JSON.stringify(session.user) : null,
    now,
    now
  );
}

// Authorization expired or was revoked: keep the account, ask the user to reconnect this provider.
export function invalidateProviderSession(user, provider) {
  if (!user) return;
  const session = getProviderSession(user, provider);
  session.access_token = null;
  session.refresh_token = null;
  session.expires_at = null;
  session.user = null;
  persistProviderSession(session);
}

// User-initiated disconnect: forget the connection entirely.
export function disconnectProvider(user, provider) {
  if (!user) return;
  cache.delete(cacheKey(user.id, provider));
  db.prepare("DELETE FROM provider_connections WHERE user_id = ? AND provider = ?").run(user.id, provider);
}

export function getProviderStatuses(userId) {
  const statuses = Object.fromEntries(PROVIDERS.map((provider) => [provider, "not_connected"]));
  const rows = db.prepare("SELECT provider, status, access_token FROM provider_connections WHERE user_id = ?").all(userId);
  for (const row of rows) {
    // An undecryptable token (changed key) can't be used, so it needs a reconnect.
    statuses[row.provider] = row.status === "connected" && decryptToken(row.access_token) ? "connected" : "needs_reconnect";
  }
  return statuses;
}
