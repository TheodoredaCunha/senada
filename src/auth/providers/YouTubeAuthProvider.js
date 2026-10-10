import { getLocalRedirectUri } from "./localRedirectUri";

const STATE_STORAGE_KEY = "universal-music:youtube:oauth-state";
const VERIFIER_STORAGE_KEY = "universal-music:youtube:oauth-verifier";
const CONNECTED_STORAGE_KEY = "universal-music:youtube:connected";

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function createCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export class YouTubeAuthProvider {
  constructor(name = "youtube") {
    this.name = name;
  }

  getClientId() {
    return import.meta.env.VITE_YOUTUBE_CLIENT_ID || "";
  }

  getRedirectUri() {
    return getLocalRedirectUri(
      import.meta.env.VITE_YOUTUBE_REDIRECT_URI,
      "/auth/youtube/callback"
    );
  }

  async login() {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error("YouTube client ID is missing. Add VITE_YOUTUBE_CLIENT_ID to the root .env file.");
    }

    const state = randomString(32);
    const codeVerifier = randomString(64);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    sessionStorage.setItem(STATE_STORAGE_KEY, state);
    sessionStorage.setItem(VERIFIER_STORAGE_KEY, codeVerifier);

    const response = await fetch("/api/youtube/oauth/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, code_verifier: codeVerifier }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to prepare YouTube authorization.");

    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
    window.location.assign(authorizationUrl.toString());
    return { provider: this.name, connected: false, redirecting: true };
  }

  async handleCallback({ code, state }) {
    const storedState = sessionStorage.getItem(STATE_STORAGE_KEY);
    const codeVerifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
    if (!storedState || storedState !== state) {
      throw new Error("YouTube authentication failed. The OAuth state did not match.");
    }
    if (!code || !codeVerifier) {
      throw new Error("YouTube authentication failed. The OAuth callback was incomplete.");
    }

    const response = await fetch("/api/youtube/oauth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state, code_verifier: codeVerifier }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.connected) {
      throw new Error(payload.error || "YouTube authentication failed.");
    }

    localStorage.setItem(CONNECTED_STORAGE_KEY, "true");
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
    return { provider: this.name, connected: true, user: payload.user };
  }

  async getCurrentUser() {
    const response = await fetch("/api/youtube/me", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.user) {
      if (response.status === 401) localStorage.removeItem(CONNECTED_STORAGE_KEY);
      throw new Error(payload.error || "Unable to load your YouTube account.");
    }
    localStorage.setItem(CONNECTED_STORAGE_KEY, "true");
    return payload.user;
  }

  async getAccessToken() {
    return null;
  }

  isConnected() {
    return localStorage.getItem(CONNECTED_STORAGE_KEY) === "true";
  }

  async logout() {
    try {
      await fetch("/api/youtube/logout", { method: "POST" });
    } catch {
      // The local connection flag must clear even when the server is unreachable.
    } finally {
      localStorage.removeItem(CONNECTED_STORAGE_KEY);
      sessionStorage.removeItem(STATE_STORAGE_KEY);
      sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
    }
    return { provider: this.name, connected: false };
  }
}
