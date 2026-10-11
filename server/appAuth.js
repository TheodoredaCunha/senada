import crypto from "node:crypto";
import { db, hashToken, newId } from "./db.js";
import { verifyFirebaseIdToken } from "./firebaseToken.js";
import { getProviderStatuses } from "./providerSessions.js";

const SESSION_COOKIE = "um_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function getCookieValue(req, cookieName) {
  const prefix = `${cookieName}=`;
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  };
}

const publicUser = (row) => ({
  id: row.id,
  displayName: row.display_name,
  email: row.email,
  avatarUrl: row.avatar_url || "",
});

export function attachUser(req, _res, next) {
  req.user = null;
  const token = getCookieValue(req, SESSION_COOKIE);
  if (token) {
    const row = db.prepare(`SELECT users.* FROM app_sessions
      JOIN users ON users.id = app_sessions.user_id
      WHERE app_sessions.id_hash = ? AND app_sessions.expires_at > ?`).get(hashToken(token), Date.now());
    if (row) req.user = row;
  }
  next();
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: "Sign in to Universal Music first." });
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO app_sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, now, now + SESSION_TTL_MS);
  db.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").run(now);
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS));
}

function upsertGoogleUser(profile) {
  const now = Date.now();
  const displayName = profile.name || profile.email || "Listener";
  const existing = db.prepare("SELECT * FROM users WHERE google_id = ?").get(profile.sub);
  if (existing) {
    db.prepare("UPDATE users SET email = ?, display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?")
      .run(profile.email, displayName, profile.picture || null, now, existing.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
  }
  const id = newId();
  db.prepare(`INSERT INTO users (id, google_id, email, display_name, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, profile.sub, profile.email, displayName, profile.picture || null, now, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function registerAppAuth(app) {
  // Firebase handles the Google sign-in in the browser; the backend only accepts a verified ID token.
  app.post("/api/auth/firebase", async (req, res) => {
    try {
      const claims = await verifyFirebaseIdToken(req.body?.idToken, process.env.FIREBASE_PROJECT_ID);
      const googleId = claims.firebase?.identities?.["google.com"]?.[0];
      if (claims.firebase?.sign_in_provider !== "google.com" || !googleId || !claims.email || claims.email_verified === false) {
        return res.status(403).json({ error: "Sign in with a verified Google account." });
      }
      const user = upsertGoogleUser({ sub: String(googleId), email: claims.email, name: claims.name, picture: claims.picture });
      startSession(res, user.id);
      return res.json({ ok: true });
    } catch (error) {
      console.error("[auth] Firebase sign-in rejected:", error.message);
      return res.status(401).json({ error: "Sign-in could not be verified. Please try again." });
    }
  });

  app.get("/api/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in." });
    const providerStatus = getProviderStatuses(req.user.id);
    return res.json({
      user: publicUser(req.user),
      providers: {
        google: true,
        youtube: providerStatus.youtube === "connected",
        spotify: providerStatus.spotify === "connected",
        soundcloud: providerStatus.soundcloud === "connected",
      },
      providerStatus,
    });
  });

  // Ends the Universal Music session only; linked provider connections stay saved.
  app.post("/api/auth/logout", (req, res) => {
    const token = getCookieValue(req, SESSION_COOKIE);
    if (token) db.prepare("DELETE FROM app_sessions WHERE id_hash = ?").run(hashToken(token));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true });
  });
}
