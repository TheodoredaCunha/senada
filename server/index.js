import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import express from "express";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

// Loaded after dotenv so database/encryption settings from .env are visible.
const { attachUser, registerAppAuth } = await import("./appAuth.js");
const { createPlaylistRouter } = await import("./playlists.js");
const {
  disconnectProvider,
  getProviderSession,
  invalidateProviderSession,
  persistProviderSession,
} = await import("./providerSessions.js");

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json({ limit: "1mb" }));
app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
  })
);
app.use(attachUser);

function normalizeLocalRedirectUri(value, fallback) {
  const redirectUri = new URL(value || fallback);
  if (
    redirectUri.port === "5173" &&
    (redirectUri.hostname === "localhost" || redirectUri.hostname === "127.0.0.1")
  ) {
    redirectUri.hostname = "127.0.0.1";
  }
  return redirectUri.toString();
}

function getClientConfig() {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID || process.env.VITE_SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  const redirectUri = normalizeLocalRedirectUri(
    process.env.SOUNDCLOUD_REDIRECT_URI || process.env.VITE_SOUNDCLOUD_REDIRECT_URI,
    "http://127.0.0.1:5173/auth/soundcloud/callback"
  );

  return { clientId, clientSecret, redirectUri };
}

function getSession(req) {
  return getProviderSession(req.user, "soundcloud");
}

// Expired or revoked authorization: flag the connection for reconnecting, keep the app account.
function deleteSession(req) {
  invalidateProviderSession(req.user, "soundcloud");
}

const SOUNDCLOUD_EXPIRED = "SoundCloud connection expired.";

// Only an expired connection is invalidated; a transient API failure must not unlink the account.
function failSoundCloud(req, res, error, message) {
  if (error.message === SOUNDCLOUD_EXPIRED) {
    deleteSession(req);
    return res.status(401).json({ error: SOUNDCLOUD_EXPIRED });
  }
  return res.status(502).json({ error: message });
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let payload = {};

    try {
      payload = JSON.parse(errorText);
    } catch {
      payload = { error: errorText || "Request failed" };
    }

    throw new Error(payload.error_description || payload.error || "Request failed");
  }

  return response.json();
}

async function fetchMe(accessToken) {
  const payload = await fetchJson("https://api.soundcloud.com/me", {
    Accept: "application/json",
    Authorization: `OAuth ${accessToken}`,
  });

  return {
    id: payload.id,
    username: payload.username,
    full_name: payload.full_name || payload.username,
    avatar_url: payload.avatar_url,
    permalink_url: payload.permalink_url,
    city: payload.city,
    country: payload.country,
  };
}

async function exchangeToken(payload) {
  const { clientId, clientSecret, redirectUri } = getClientConfig();

  if (!clientId || !clientSecret) {
    throw new Error("SoundCloud OAuth is not configured yet. Add the server-side client ID and client secret to the backend environment.");
  }

  const form = new URLSearchParams({
    ...payload,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: form,
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.access_token) {
    throw new Error(
      result.error_description ||
        result.error ||
        "SoundCloud authentication failed while exchanging the authorization code."
    );
  }

  return result;
}

async function refreshAccessToken(session) {
  if (!session.refresh_token) {
    throw new Error("SoundCloud connection expired.");
  }

  const tokenResponse = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
  });

  session.access_token = tokenResponse.access_token;
  session.refresh_token = tokenResponse.refresh_token || session.refresh_token;
  session.expires_at = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;
  persistProviderSession(session);

  return session.access_token;
}

async function ensureValidSession(session) {
  if (!session.access_token) {
    throw new Error("SoundCloud connection expired.");
  }

  if (session.expires_at && Date.now() >= session.expires_at - 60_000) {
    const refreshedToken = await refreshAccessToken(session).catch(() => null);
    if (!refreshedToken) {
      throw new Error("SoundCloud connection expired.");
    }
  }

  return session.access_token;
}

async function fetchPaginatedCollection(url, accessToken) {
  let nextUrl = url;
  const items = [];

  while (nextUrl) {
    const payload = await fetchJson(nextUrl, {
      Accept: "application/json",
      Authorization: `OAuth ${accessToken}`,
    });

    if (Array.isArray(payload)) {
      items.push(...payload);
      nextUrl = null;
      continue;
    }

    const collection = Array.isArray(payload.collection)
      ? payload.collection
      : Array.isArray(payload.items)
        ? payload.items
        : [];

    items.push(...collection);
    nextUrl = payload.next_href || null;
  }

  return items;
}

const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function getYouTubeConfig() {
  return {
    clientId: process.env.YOUTUBE_CLIENT_ID || process.env.VITE_YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: normalizeLocalRedirectUri(
      process.env.YOUTUBE_REDIRECT_URI || process.env.VITE_YOUTUBE_REDIRECT_URI,
      "http://127.0.0.1:5173/auth/youtube/callback"
    ),
  };
}

function getYouTubeSession(req) {
  return getProviderSession(req.user, "youtube");
}

function clearYouTubeSession(req) {
  invalidateProviderSession(req.user, "youtube");
}

function assertYouTubeConfig() {
  const { clientId, clientSecret } = getYouTubeConfig();
  if (!clientId) throw new Error("YouTube OAuth is not configured: YOUTUBE_CLIENT_ID is missing.");
  if (!clientSecret) throw new Error("YouTube OAuth is not configured: YOUTUBE_CLIENT_SECRET is missing.");
}

async function exchangeYouTubeToken(payload) {
  assertYouTubeConfig();
  const { clientId, clientSecret, redirectUri } = getYouTubeConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...payload,
      client_id: clientId,
      client_secret: clientSecret,
      ...(payload.grant_type === "authorization_code" ? { redirect_uri: redirectUri } : {}),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "Google token exchange failed.");
  }
  return result;
}

async function fetchYouTubeJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = payload.error?.message;
    throw new Error(apiMessage || "YouTube Data API request failed.");
  }
  return payload;
}

async function fetchYouTubeUser(accessToken) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({ part: "snippet,contentDetails", mine: "true" });
  const payload = await fetchYouTubeJson(url, accessToken);
  const channel = payload.items?.[0];
  if (!channel) throw new Error("Google did not return a YouTube channel for this account.");
  return {
    id: channel.id,
    title: channel.snippet?.title || "YouTube account",
    thumbnail:
      channel.snippet?.thumbnails?.high?.url ||
      channel.snippet?.thumbnails?.medium?.url ||
      channel.snippet?.thumbnails?.default?.url ||
      "",
  };
}

async function refreshYouTubeAccessToken(session) {
  if (!session.refresh_token) throw new Error("YouTube connection expired.");
  const tokenResponse = await exchangeYouTubeToken({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
  });
  session.access_token = tokenResponse.access_token;
  session.refresh_token = tokenResponse.refresh_token || session.refresh_token;
  session.expires_at = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;
  persistProviderSession(session);
  return session.access_token;
}

async function ensureValidYouTubeSession(session) {
  if (!session.access_token) throw new Error("YouTube connection expired.");
  if (session.expires_at && Date.now() >= session.expires_at - 60_000) {
    try {
      await refreshYouTubeAccessToken(session);
    } catch {
      session.access_token = null;
      session.refresh_token = null;
      session.expires_at = null;
      session.user = null;
      persistProviderSession(session);
      throw new Error("YouTube connection expired.");
    }
  }
  return session.access_token;
}

async function fetchAllYouTubePages(endpoint, parameters, accessToken) {
  const items = [];
  let pageToken = "";
  do {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ ...parameters, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    const payload = await fetchYouTubeJson(url, accessToken);
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return items;
}

async function withYouTubeSession(req, res, handler, failureMessage) {
  const session = getYouTubeSession(req, res);
  try {
    const accessToken = await ensureValidYouTubeSession(session);
    return await handler(session, accessToken);
  } catch (error) {
    const expired = error.message === "YouTube connection expired.";
    if (expired) clearYouTubeSession(req, res);
    return res.status(expired ? 401 : 502).json({
      error: expired ? error.message : `${failureMessage} ${error.message}`,
    });
  }
}

function getSpotifyConfig() {
  return {
    clientId: process.env.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID,
    redirectUri: normalizeLocalRedirectUri(
      process.env.SPOTIFY_REDIRECT_URI || process.env.VITE_SPOTIFY_REDIRECT_URI,
      "http://127.0.0.1:5173/auth/spotify/callback"
    ),
  };
}

function getSpotifySession(req) {
  return getProviderSession(req.user, "spotify");
}

function clearSpotifySession(req) {
  invalidateProviderSession(req.user, "spotify");
}

function assertSpotifyConfig() {
  const { clientId, redirectUri } = getSpotifyConfig();
  const frontendClientId = process.env.VITE_SPOTIFY_CLIENT_ID;
  const frontendRedirectUri = normalizeLocalRedirectUri(
    process.env.VITE_SPOTIFY_REDIRECT_URI,
    "http://127.0.0.1:5173/auth/spotify/callback"
  );
  if (!clientId) {
    const error = new Error("Spotify client ID is missing from the backend configuration.");
    error.spotifyStage = "client_id_validation";
    throw error;
  }
  if (frontendClientId && frontendClientId !== clientId) {
    const error = new Error("Spotify frontend and backend client IDs do not match.");
    error.spotifyStage = "client_id_validation";
    throw error;
  }
  if (redirectUri !== frontendRedirectUri) {
    const error = new Error("Spotify frontend and backend redirect URIs do not match.");
    error.spotifyStage = "redirect_uri_validation";
    throw error;
  }
}

function sanitizeSpotifyError(value) {
  return String(value || "unknown Spotify error")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/((?:access_token|refresh_token|client_secret|code_verifier|authorization_code|state)\s*[=:]\s*)[^&\s,}"']+/gi, "$1[redacted]")
    .slice(0, 800);
}

function sanitizeSpotifyResponseBody(payload, rawBody) {
  if (payload && typeof payload === "object") {
    const error = payload.error;
    if (error && typeof error === "object") {
      return {
        error: {
          status: error.status,
          message: sanitizeSpotifyError(error.message),
          reason: sanitizeSpotifyError(error.reason),
        },
      };
    }
    if (typeof error === "string") {
      return { error: sanitizeSpotifyError(error) };
    }
    return sanitizeSpotifyError(JSON.stringify(payload));
  }
  return sanitizeSpotifyError(rawBody);
}

function logSpotifyOAuthDiagnostic(stage, details = {}) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[spotify-oauth] callback diagnostic", { stage, ...details });
}

async function exchangeSpotifyToken(parameters) {
  assertSpotifyConfig();
  const { clientId, redirectUri } = getSpotifyConfig();
  const form = new URLSearchParams({ ...parameters, client_id: clientId });
  if (parameters.grant_type === "authorization_code") form.set("redirect_uri", redirectUri);

  let response;
  try {
    response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch (error) {
    error.spotifyStage = "token_exchange_transport";
    throw error;
  }

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const responseBody = sanitizeSpotifyResponseBody(payload, responseText);
    const wwwAuthenticate = sanitizeSpotifyError(response.headers.get("www-authenticate"));
    const spotifyErrorStatus = payload?.error?.status;
    const spotifyErrorMessage = sanitizeSpotifyError(payload?.error?.message || payload?.error_description || payload?.error);
    const error = new Error(spotifyErrorMessage === "unknown Spotify error"
      ? "Spotify API request failed."
      : spotifyErrorMessage);
    error.httpStatus = response.status;
    error.spotifyErrorStatus = spotifyErrorStatus;
    error.spotifyErrorMessage = spotifyErrorMessage;
    error.spotifyResponseBody = responseBody;
    error.wwwAuthenticate = wwwAuthenticate;
    throw error;
  }
  if (!payload) {
    const error = new Error("Spotify API returned an invalid JSON response.");
    error.httpStatus = response.status;
    error.spotifyResponseBody = sanitizeSpotifyError(responseText);
    throw error;
  }
  return payload;
}

async function refreshSpotifyAccessToken(session) {
  if (!session.refresh_token) throw new Error("Spotify connection expired.");
  const payload = await exchangeSpotifyToken({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
  });
  session.access_token = payload.access_token;
  session.refresh_token = payload.refresh_token || session.refresh_token;
  session.expires_at = Date.now() + Number(payload.expires_in || 3600) * 1000;
  persistProviderSession(session);
  return session.access_token;
}

async function ensureValidSpotifySession(session) {
  if (!session.access_token) throw new Error("Spotify connection expired.");
  if (session.expires_at && Date.now() >= session.expires_at - 60_000) {
    try {
      await refreshSpotifyAccessToken(session);
    } catch {
      session.access_token = null;
      session.refresh_token = null;
      session.expires_at = null;
      session.user = null;
      persistProviderSession(session);
      throw new Error("Spotify connection expired.");
    }
  }
  return session.access_token;
}

async function fetchSpotifyJson(url, accessToken, options = {}) {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    const error = new Error("Spotify API request cannot be made without an access token.");
    error.spotifyStage = "access_token_validation";
    throw error;
  }

  if (new URL(url).pathname === "/v1/me") {
    logSpotifyOAuthDiagnostic("profile_request_sent", {
      authorizationScheme: "Bearer",
      accessTokenPresent: true,
    });
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const responseBody = sanitizeSpotifyResponseBody(payload, responseText);
    const wwwAuthenticate = sanitizeSpotifyError(response.headers.get("www-authenticate"));
    const spotifyErrorStatus = payload?.error?.status;
    const spotifyErrorMessage = sanitizeSpotifyError(payload?.error?.message || payload?.error_description || payload?.error);
    const error = new Error(spotifyErrorMessage === "unknown Spotify error"
      ? "Spotify API request failed."
      : spotifyErrorMessage);
    error.httpStatus = response.status;
    error.spotifyErrorStatus = spotifyErrorStatus;
    error.spotifyErrorMessage = spotifyErrorMessage;
    error.spotifyResponseBody = responseBody;
    error.wwwAuthenticate = wwwAuthenticate;
    throw error;
  }
  if (!payload) {
    const error = new Error("Spotify API returned an invalid JSON response.");
    error.httpStatus = response.status;
    error.spotifyResponseBody = sanitizeSpotifyError(responseText);
    throw error;
  }
  return payload;
}

async function withSpotifySession(req, res, handler, failureMessage) {
  const session = getSpotifySession(req, res);
  try {
    const accessToken = await ensureValidSpotifySession(session);
    return await handler(session, accessToken);
  } catch (error) {
    const expired = error.message === "Spotify connection expired.";
    if (expired) clearSpotifySession(req, res);
    return res.status(expired ? 401 : 502).json({
      error: expired ? error.message : `${failureMessage} ${error.message}`,
    });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

registerAppAuth(app);
app.use("/api/playlists", createPlaylistRouter());

// Provider links belong to a signed-in Universal Music user.
app.use(["/api/soundcloud", "/api/youtube", "/api/spotify"], (req, res, next) => {
  if (req.user) return next();
  if (req.method === "GET" && req.path === "/session") return res.json({ connected: false });
  return res.status(401).json({ error: "Sign in to Universal Music first." });
});

app.post("/api/soundcloud/oauth/prepare", (req, res) => {
  const session = getSession(req, res);
  const { state, code_verifier } = req.body || {};

  if (!state || !code_verifier) {
    return res.status(400).json({ error: "Missing OAuth state or PKCE verifier." });
  }

  session.state = state;
  session.code_verifier = code_verifier;
  session.updatedAt = Date.now();

  return res.json({ ok: true });
});

app.post("/api/soundcloud/oauth/callback", async (req, res) => {
  const session = getSession(req, res);
  const { code, state, code_verifier } = req.body || {};

  if (!code || !state || !code_verifier) {
    return res.status(400).json({
      error: "SoundCloud authentication failed. The callback did not include the required OAuth parameters.",
    });
  }

  if (!session.state || session.state !== state) {
    return res.status(400).json({
      error: "SoundCloud authentication failed. The OAuth state did not match.",
    });
  }

  if (!session.code_verifier || session.code_verifier !== code_verifier) {
    return res.status(400).json({
      error: "SoundCloud authentication failed. The PKCE verifier did not match.",
    });
  }

  try {
    const tokenResponse = await exchangeToken({
      grant_type: "authorization_code",
      code,
      code_verifier,
    });

    session.access_token = tokenResponse.access_token;
    session.refresh_token = tokenResponse.refresh_token || session.refresh_token || null;
    session.expires_at =
      Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;

    session.user = await fetchMe(session.access_token);
    session.state = null;
    session.code_verifier = null;
    persistProviderSession(session);

    return res.json({ ok: true, connected: true, user: session.user });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "SoundCloud authentication failed.",
    });
  }
});

app.get("/api/soundcloud/session", async (req, res) => {
  const session = getSession(req, res);

  try {
    if (!session.access_token) {
      return res.json({ connected: false });
    }

    const accessToken = await ensureValidSession(session);
    if (!session.user) {
      session.user = await fetchMe(accessToken);
    }

    return res.json({ connected: true, user: session.user });
  } catch (error) {
    if (error.message === SOUNDCLOUD_EXPIRED) {
      deleteSession(req);
      return res.json({ connected: false, error: SOUNDCLOUD_EXPIRED });
    }
    return res.status(502).json({ error: "Unable to restore your SoundCloud session." });
  }
});

app.get("/api/soundcloud/me", async (req, res) => {
  const session = getSession(req, res);

  try {
    const accessToken = await ensureValidSession(session);
    session.user = session.user || (await fetchMe(accessToken));
    return res.json({ connected: true, user: session.user });
  } catch (error) {
    return failSoundCloud(req, res, error, "Unable to load your SoundCloud account.");
  }
});

app.get("/api/soundcloud/likes/tracks", async (req, res) => {
  const session = getSession(req, res);

  try {
    const accessToken = await ensureValidSession(session);
    const likedItems = await fetchPaginatedCollection(
      "https://api.soundcloud.com/me/likes/tracks?linked_partitioning=true&limit=200",
      accessToken
    );

    return res.json({ connected: true, tracks: likedItems });
  } catch (error) {
    return failSoundCloud(req, res, error, "Unable to load your SoundCloud liked songs.");
  }
});

app.get("/api/soundcloud/playlists", async (req, res) => {
  const session = getSession(req, res);

  try {
    const accessToken = await ensureValidSession(session);
    const playlists = await fetchPaginatedCollection(
      "https://api.soundcloud.com/me/playlists?linked_partitioning=true&limit=200",
      accessToken
    );

    return res.json({ connected: true, playlists });
  } catch (error) {
    return failSoundCloud(req, res, error, "Unable to load your SoundCloud playlists.");
  }
});

app.get("/api/soundcloud/playlists/:playlistId/tracks", async (req, res) => {
  const session = getSession(req, res);

  try {
    const accessToken = await ensureValidSession(session);
    const playlist = await fetchJson(
      `https://api.soundcloud.com/playlists/${req.params.playlistId}`,
      {
        Accept: "application/json",
        Authorization: `OAuth ${accessToken}`,
      }
    );

    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    return res.json({ connected: true, tracks });
  } catch (error) {
    return failSoundCloud(req, res, error, "Unable to load that SoundCloud playlist.");
  }
});

app.post("/api/soundcloud/logout", (req, res) => {
  disconnectProvider(req.user, "soundcloud");
  return res.json({ ok: true, disconnected: true });
});

app.post("/api/youtube/oauth/prepare", (req, res) => {
  const { state, code_verifier } = req.body || {};
  if (!state || !code_verifier) {
    return res.status(400).json({ error: "Missing OAuth state or PKCE verifier." });
  }
  try {
    assertYouTubeConfig();
    const session = getYouTubeSession(req, res);
    session.state = state;
    session.code_verifier = code_verifier;
    session.oauth_started_at = Date.now();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

app.post("/api/youtube/oauth/callback", async (req, res) => {
  const session = getYouTubeSession(req, res);
  const { code, state, code_verifier } = req.body || {};
  if (!code || !state || !code_verifier) {
    return res.status(400).json({ error: "YouTube OAuth callback is missing required parameters." });
  }
  if (!session.state || session.state !== state) {
    return res.status(400).json({ error: "YouTube authentication failed. The OAuth state did not match." });
  }
  if (!session.oauth_started_at || Date.now() - session.oauth_started_at > 10 * 60 * 1000) {
    session.state = null;
    session.code_verifier = null;
    session.oauth_started_at = null;
    return res.status(400).json({ error: "YouTube authentication expired. Please connect again." });
  }
  if (!session.code_verifier) {
    session.state = null;
    session.oauth_started_at = null;
    return res.status(400).json({ error: "YouTube authentication failed. The PKCE verifier is missing." });
  }
  try {
    const tokenResponse = await exchangeYouTubeToken({
      grant_type: "authorization_code",
      code,
      code_verifier,
    });
    session.access_token = tokenResponse.access_token;
    session.refresh_token = tokenResponse.refresh_token || session.refresh_token || null;
    session.expires_at = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000;
    session.user = await fetchYouTubeUser(session.access_token);
    session.state = null;
    session.code_verifier = null;
    persistProviderSession(session);
    return res.json({ connected: true, user: session.user });
  } catch (error) {
    session.state = null;
    session.code_verifier = null;
    session.oauth_started_at = null;
    return res.status(400).json({ error: error.message || "YouTube authentication failed." });
  }
});

app.get("/api/youtube/session", async (req, res) => {
  const session = getYouTubeSession(req, res);
  if (!session.access_token) return res.json({ connected: false });
  return withYouTubeSession(req, res, async (activeSession, accessToken) => {
    activeSession.user = activeSession.user || (await fetchYouTubeUser(accessToken));
    return res.json({ connected: true, user: activeSession.user });
  }, "Unable to restore your YouTube session.");
});

app.get("/api/youtube/me", (req, res) =>
  withYouTubeSession(req, res, async (session, accessToken) => {
    session.user = await fetchYouTubeUser(accessToken);
    return res.json({ connected: true, user: session.user });
  }, "Unable to load your YouTube account."));

app.get("/api/youtube/likes/videos", (req, res) =>
  withYouTubeSession(req, res, async (_session, accessToken) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(50, Math.max(1, requestedLimit))
      : 50;
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.search = new URLSearchParams({
      part: "snippet,contentDetails",
      myRating: "like",
      maxResults: String(limit),
      ...(typeof req.query.pageToken === "string" && req.query.pageToken
        ? { pageToken: req.query.pageToken }
        : {}),
    });
    const payload = await fetchYouTubeJson(url, accessToken);
    return res.json({
      videos: Array.isArray(payload.items) ? payload.items : [],
      nextPageToken: payload.nextPageToken || null,
    });
  }, "Unable to load your YouTube liked videos."));

app.get("/api/youtube/playlists", (req, res) =>
  withYouTubeSession(req, res, async (_session, accessToken) => {
    const playlists = await fetchAllYouTubePages(
      "https://www.googleapis.com/youtube/v3/playlists",
      { part: "snippet,contentDetails", mine: "true" },
      accessToken
    );
    return res.json({ playlists });
  }, "Unable to load your YouTube playlists."));

app.get("/api/youtube/playlists/:playlistId/videos", (req, res) =>
  withYouTubeSession(req, res, async (_session, accessToken) => {
    const items = await fetchAllYouTubePages(
      "https://www.googleapis.com/youtube/v3/playlistItems",
      { part: "snippet,contentDetails", playlistId: req.params.playlistId },
      accessToken
    );
    const videos = items
      .filter((item) => item.snippet?.resourceId?.videoId)
      .map((item) => ({
        id: item.snippet.resourceId.videoId,
        snippet: item.snippet,
        contentDetails: item.contentDetails || {},
      }));
    return res.json({ videos });
  }, "Unable to load videos from that YouTube playlist."));

app.post("/api/youtube/logout", (req, res) => {
  disconnectProvider(req.user, "youtube");
  return res.json({ ok: true, disconnected: true });
});

app.post("/api/spotify/oauth/prepare", (req, res) => {
  const { state, code_verifier } = req.body || {};
  if (!state || !code_verifier) {
    return res.status(400).json({ error: "Missing Spotify OAuth state or PKCE verifier." });
  }
  try {
    assertSpotifyConfig();
    const session = getSpotifySession(req, res);
    session.state = state;
    session.code_verifier = code_verifier;
    session.oauth_started_at = Date.now();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

app.post("/api/spotify/oauth/callback", async (req, res) => {
  const session = getSpotifySession(req, res);
  const { code, state } = req.body || {};
  const cookiePresent = Boolean(req.user);
  let stage = "request_validation";
  const clearPendingOAuth = () => {
    session.state = null;
    session.code_verifier = null;
    session.oauth_started_at = null;
  };

  if (!code || !state) {
    logSpotifyOAuthDiagnostic(stage, {
      codePresent: Boolean(code),
      returnedStatePresent: Boolean(state),
      sessionCookiePresent: cookiePresent,
    });
    clearPendingOAuth();
    return res.status(400).json({ error: "Spotify callback is missing an authorization code or state." });
  }

  stage = "state_validation";
  const stateMatches = Boolean(session.state && session.state === state);
  if (!stateMatches) {
    logSpotifyOAuthDiagnostic(stage, {
      expectedStatePresent: Boolean(session.state),
      returnedStatePresent: true,
      matches: false,
      sessionCookiePresent: cookiePresent,
    });
    clearPendingOAuth();
    return res.status(400).json({ error: "Spotify authentication failed. The OAuth state did not match." });
  }

  if (!session.oauth_started_at || Date.now() - session.oauth_started_at > 10 * 60 * 1000) {
    stage = "state_expiration";
    logSpotifyOAuthDiagnostic(stage, { stateValidated: true, sessionCookiePresent: cookiePresent });
    clearPendingOAuth();
    return res.status(400).json({ error: "Spotify authentication expired. Please connect again." });
  }

  stage = "pkce_verifier_validation";
  if (!session.code_verifier) {
    logSpotifyOAuthDiagnostic(stage, { verifierPresent: false, stateValidated: true });
    clearPendingOAuth();
    return res.status(400).json({ error: "Spotify authentication failed. The PKCE verifier is missing." });
  }

  try {
    stage = "oauth_configuration_validation";
    assertSpotifyConfig();
    const config = getSpotifyConfig();
    logSpotifyOAuthDiagnostic("oauth_configuration_validated", {
      clientIdPresent: Boolean(config.clientId),
      frontendClientIdPresent: Boolean(process.env.VITE_SPOTIFY_CLIENT_ID),
      clientIdsMatch: !process.env.VITE_SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID === config.clientId,
      redirectUri: config.redirectUri,
      frontendRedirectUri: normalizeLocalRedirectUri(
        process.env.VITE_SPOTIFY_REDIRECT_URI,
        "http://127.0.0.1:5173/auth/spotify/callback"
      ),
    });

    stage = "token_exchange";
    const tokenPayload = await exchangeSpotifyToken({
      grant_type: "authorization_code",
      code,
      code_verifier: session.code_verifier,
    });

    stage = "token_response_validation";
    if (!tokenPayload.access_token) throw new Error("Spotify token response did not include an access token.");

    session.access_token = tokenPayload.access_token;
    session.refresh_token = tokenPayload.refresh_token || null;
    session.expires_at = Date.now() + Number(tokenPayload.expires_in || 3600) * 1000;

    logSpotifyOAuthDiagnostic("token_exchange_succeeded", {
      accessTokenPresent: Boolean(tokenPayload.access_token),
      tokenType: sanitizeSpotifyError(tokenPayload.token_type),
      expiresIn: Number(tokenPayload.expires_in) || null,
      grantedScopes: String(tokenPayload.scope || ""),
      redirectUri: tokenPayload.grant_type === "authorization_code" ? redirectUri : undefined,
      sessionAccessTokenMatchesNewToken: session.access_token === tokenPayload.access_token,
    });
    if (!session.access_token || session.access_token !== tokenPayload.access_token) {
      stage = "access_token_validation";
      throw new Error("Spotify did not retain the newly issued access token in the session.");
    }

    stage = "profile_request";
    session.user = await fetchSpotifyJson("https://api.spotify.com/v1/me", session.access_token);
    clearPendingOAuth();
    persistProviderSession(session);
    return res.json({ connected: true, user: session.user });
  } catch (error) {
    logSpotifyOAuthDiagnostic(error.spotifyStage || stage, {
      httpStatus: error.httpStatus,
      spotifyErrorStatus: error.spotifyErrorStatus,
      spotifyErrorMessage: error.spotifyErrorMessage || sanitizeSpotifyError(error.message),
      spotifyResponseBody: error.spotifyResponseBody,
      wwwAuthenticate: error.wwwAuthenticate,
    });
    clearPendingOAuth();
    return res.status(400).json({ error: sanitizeSpotifyError(error.message || "Spotify authentication failed.") });
  }
});

app.post("/api/spotify/oauth/cancel", (req, res) => {
  const session = getSpotifySession(req, res);
  session.state = null;
  session.code_verifier = null;
  session.oauth_started_at = null;
  return res.json({ ok: true });
});

app.get("/api/spotify/session", async (req, res) => {
  const session = getSpotifySession(req, res);
  if (!session.access_token) return res.json({ connected: false });
  return withSpotifySession(req, res, async (activeSession, accessToken) => {
    activeSession.user = activeSession.user || await fetchSpotifyJson("https://api.spotify.com/v1/me", accessToken);
    return res.json({ connected: true, user: activeSession.user });
  }, "Unable to restore your Spotify session.");
});

app.get("/api/spotify/me", (req, res) =>
  withSpotifySession(req, res, async (session, accessToken) => {
    session.user = await fetchSpotifyJson("https://api.spotify.com/v1/me", accessToken);
    return res.json({ connected: true, user: session.user });
  }, "Unable to load your Spotify account."));

app.get("/api/spotify/access-token", (req, res) => {
  res.set("Cache-Control", "no-store");
  return withSpotifySession(
    req,
    res,
    async (_session, accessToken) => res.json({ accessToken }),
    "Unable to authorize Spotify playback."
  );
});

app.get("/api/spotify/saved-tracks", (req, res) =>
  withSpotifySession(req, res, async (_session, accessToken) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 50;
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    const url = new URL("https://api.spotify.com/v1/me/tracks");
    url.search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const payload = await fetchSpotifyJson(url, accessToken);
    const nextOffset = offset + (payload.items?.length || 0);
    return res.json({
      items: Array.isArray(payload.items) ? payload.items : [],
      nextOffset: nextOffset < Number(payload.total || 0) ? nextOffset : null,
    });
  }, "Unable to load your Spotify saved tracks."));

app.post("/api/spotify/player/play", (req, res) => {
  const { device_id, uri, transfer } = req.body || {};
  if (!device_id || typeof uri !== "string" || !/^spotify:track:[A-Za-z0-9]+$/.test(uri)) {
    return res.status(400).json({ error: "A Spotify device and valid track URI are required." });
  }
  return withSpotifySession(req, res, async (_session, accessToken) => {
    const startPlayback = () => fetchSpotifyJson(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device_id)}`,
      accessToken,
      { method: "PUT", body: JSON.stringify({ uris: [uri] }) }
    );
    const transferPlayback = () => fetchSpotifyJson("https://api.spotify.com/v1/me/player", accessToken, {
      method: "PUT",
      body: JSON.stringify({ device_ids: [device_id], play: false }),
    });
    // A freshly ready SDK device can take a moment to appear in Spotify's device list.
    const retryOn404 = async (action) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await action();
        } catch (error) {
          if (error.httpStatus !== 404 || attempt >= 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
    };
    if (transfer) await retryOn404(transferPlayback);
    await retryOn404(startPlayback);
    return res.json({ ok: true });
  }, "Unable to start Spotify playback.");
});

app.post("/api/spotify/player/pause", (req, res) =>
  withSpotifySession(req, res, async (_session, accessToken) => {
    try {
      await fetchSpotifyJson("https://api.spotify.com/v1/me/player/pause", accessToken, { method: "PUT" });
    } catch (error) {
      // 404: nothing is playing; 403: already paused.
      if (error.httpStatus !== 404 && error.httpStatus !== 403) throw error;
    }
    return res.json({ ok: true });
  }, "Unable to pause Spotify playback."));

app.post("/api/spotify/player/resume", (req, res) =>
  withSpotifySession(req, res, async (_session, accessToken) => {
    await fetchSpotifyJson("https://api.spotify.com/v1/me/player/play", accessToken, { method: "PUT" });
    return res.json({ ok: true });
  }, "Unable to resume Spotify playback."));

app.post("/api/spotify/player/seek", (req, res) => {
  const positionMs = Math.floor(Number(req.body?.position_ms));
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return res.status(400).json({ error: "A valid seek position is required." });
  }
  return withSpotifySession(req, res, async (_session, accessToken) => {
    await fetchSpotifyJson(
      `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`,
      accessToken,
      { method: "PUT" }
    );
    return res.json({ ok: true });
  }, "Unable to seek Spotify playback.");
});

app.post("/api/spotify/logout", (req, res) => {
  disconnectProvider(req.user, "spotify");
  return res.json({ ok: true, disconnected: true });
});

app.listen(port, () => {
  console.log(`Music backend listening on http://localhost:${port}`);
});
