import { getLocalRedirectUri } from "./localRedirectUri";

const STATE_STORAGE_KEY = "universal-music:soundcloud:oauth-state";
const VERIFIER_STORAGE_KEY = "universal-music:soundcloud:oauth-verifier";
const CONNECTED_STORAGE_KEY = "universal-music:soundcloud:connected";

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function sha256(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return hashBuffer;
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class SoundCloudAuthProvider {
  constructor(name = "soundcloud") {
    this.name = name;
  }

  getClientId() {
    return import.meta.env.VITE_SOUNDCLOUD_CLIENT_ID || "";
  }

  getRedirectUri() {
    return getLocalRedirectUri(
      import.meta.env.VITE_SOUNDCLOUD_REDIRECT_URI,
      "/auth/soundcloud/callback"
    );
  }

  async login() {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error(
        "SoundCloud client ID is missing. Add VITE_SOUNDCLOUD_CLIENT_ID to your .env file."
      );
    }

    const state = randomString(24);
    const codeVerifier = randomString(64);
    const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

    sessionStorage.setItem(STATE_STORAGE_KEY, state);
    sessionStorage.setItem(VERIFIER_STORAGE_KEY, codeVerifier);

    const prepareResponse = await fetch("/api/soundcloud/oauth/prepare", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, code_verifier: codeVerifier }),
    });

    if (!prepareResponse.ok) {
      const payload = await prepareResponse.json().catch(() => ({}));
      throw new Error(
        payload.error || "SoundCloud authentication failed while preparing the OAuth request."
      );
    }

    const authUrl = new URL("https://soundcloud.com/connect");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", this.getRedirectUri());
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", "non-expiring");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    window.location.assign(authUrl.toString());

    return { provider: this.name, connected: false, redirecting: true };
  }

  async handleCallback({ code, state }) {
    const storedState = sessionStorage.getItem(STATE_STORAGE_KEY);
    const codeVerifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);

    if (!storedState || storedState !== state) {
      throw new Error("SoundCloud authentication failed. The OAuth state did not match.");
    }

    if (!code || !codeVerifier) {
      throw new Error("SoundCloud authentication failed. The OAuth callback was incomplete.");
    }

    const response = await fetch("/api/soundcloud/oauth/callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        state,
        code_verifier: codeVerifier,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.connected) {
      throw new Error(payload.error || "SoundCloud authentication failed.");
    }

    localStorage.setItem(CONNECTED_STORAGE_KEY, "true");
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_STORAGE_KEY);

    return { provider: this.name, connected: true, user: payload.user };
  }

  async getCurrentUser() {
    const response = await fetch("/api/soundcloud/me", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload.error || "Unable to load your SoundCloud profile.";
      throw new Error(
        message === "SoundCloud connection expired." ? "SoundCloud connection expired." : message
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!payload.user) {
      throw new Error("SoundCloud did not return your profile information.");
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
      await fetch("/api/soundcloud/logout", { method: "POST" });
    } catch {
      // ignored intentionally: the app should still disconnect locally
    }

    localStorage.removeItem(CONNECTED_STORAGE_KEY);
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_STORAGE_KEY);

    return { provider: this.name, connected: false };
  }
}
