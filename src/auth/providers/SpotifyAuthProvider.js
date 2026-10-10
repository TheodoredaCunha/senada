const STATE_STORAGE_KEY = "universal-music:spotify:oauth-state";
const CONNECTED_STORAGE_KEY = "universal-music:spotify:connected";
let callbackStateInFlight = null;
let callbackPromise = null;
let callbackInvocationCount = 0;
const SPOTIFY_SCOPES = [
  "streaming",
  "user-library-read",
  "user-read-private",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
].join(" ");

function randomString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
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

export class SpotifyAuthProvider {
  constructor(name = "spotify") {
    this.name = name;
  }

  getClientId() {
    return import.meta.env.VITE_SPOTIFY_CLIENT_ID || "";
  }

  getRedirectUri() {
    return import.meta.env.VITE_SPOTIFY_REDIRECT_URI ||
      "http://127.0.0.1:5173/auth/spotify/callback";
  }

  async login() {
    const clientId = this.getClientId();
    if (!clientId) throw new Error("Spotify client ID is missing. Set VITE_SPOTIFY_CLIENT_ID in the root .env.");

    const redirectUri = new URL(this.getRedirectUri());
    if (window.location.origin !== redirectUri.origin) {
      window.location.replace(`${redirectUri.origin}${window.location.pathname}${window.location.search}${window.location.hash}`);
      return { provider: this.name, connected: false, redirecting: true };
    }

    callbackStateInFlight = null;
    callbackPromise = null;
    const state = randomString(32);
    const codeVerifier = randomString(64);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    sessionStorage.setItem(STATE_STORAGE_KEY, state);

    let response;
    try {
      response = await fetch("/api/spotify/oauth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, code_verifier: codeVerifier }),
      });
    } catch (error) {
      await this.cancelPendingLogin();
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      await this.cancelPendingLogin();
      throw new Error(payload.error || "Unable to prepare Spotify authorization.");
    }

    const authorizationUrl = new URL("https://accounts.spotify.com/authorize");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri.toString(),
      scope: SPOTIFY_SCOPES,
      state,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
    });
    window.location.assign(authorizationUrl.toString());
    return { provider: this.name, connected: false, redirecting: true };
  }

  async handleCallback({ code, state }) {
    callbackInvocationCount += 1;
    const storedState = sessionStorage.getItem(STATE_STORAGE_KEY);
    const stateMatches = Boolean(storedState && state && storedState === state);
    if (import.meta.env.DEV) {
      console.info("[spotify-oauth] frontend callback", {
        handler: "SpotifyAuthProvider.handleCallback",
        invocation: callbackInvocationCount,
        returnedStatePresent: Boolean(state),
        expectedStatePresent: Boolean(storedState),
        stateMatches,
        alreadyProcessing: callbackStateInFlight === state && Boolean(callbackPromise),
        origin: window.location.origin,
      });
    }
    if (callbackStateInFlight === state && callbackPromise) return callbackPromise;
    if (!stateMatches) {
      sessionStorage.removeItem(STATE_STORAGE_KEY);
      await this.cancelPendingLogin();
      throw new Error("Spotify authentication failed. The OAuth state did not match.");
    }
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    if (!code) {
      await this.cancelPendingLogin();
      throw new Error("Spotify authentication did not return an authorization code.");
    }

    callbackStateInFlight = state;
    callbackPromise = (async () => {
      try {
        const response = await fetch("/api/spotify/oauth/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.connected || !payload.user) {
          throw new Error(payload.error || "Spotify authentication failed.");
        }

        localStorage.setItem(CONNECTED_STORAGE_KEY, "true");
        return { provider: this.name, connected: true, user: payload.user };
      } catch (error) {
        callbackStateInFlight = null;
        callbackPromise = null;
        throw error;
      }
    })();
    return callbackPromise;
  }

  async getCurrentUser() {
    const response = await fetch("/api/spotify/me", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.user) {
      if (response.status === 401) localStorage.removeItem(CONNECTED_STORAGE_KEY);
      throw new Error(payload.error || "Unable to load your Spotify profile.");
    }
    localStorage.setItem(CONNECTED_STORAGE_KEY, "true");
    return payload.user;
  }

  async getAccessToken() {
    const response = await fetch("/api/spotify/access-token", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.accessToken) {
      if (response.status === 401) localStorage.removeItem(CONNECTED_STORAGE_KEY);
      throw new Error(payload.error || "Spotify connection expired.");
    }
    return payload.accessToken;
  }

  isConnected() {
    return localStorage.getItem(CONNECTED_STORAGE_KEY) === "true";
  }

  async logout() {
    try {
      await fetch("/api/spotify/logout", { method: "POST" });
    } finally {
      localStorage.removeItem(CONNECTED_STORAGE_KEY);
      sessionStorage.removeItem(STATE_STORAGE_KEY);
    }
    return { provider: this.name, connected: false };
  }

  clearPendingState() {
    sessionStorage.removeItem(STATE_STORAGE_KEY);
  }

  async cancelPendingLogin() {
    this.clearPendingState();
    try {
      await fetch("/api/spotify/oauth/cancel", { method: "POST" });
    } catch {
      // The browser state is still cleared if the backend is unreachable.
    }
  }
}
