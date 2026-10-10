import { markPlayback, markPlaying } from "../playbackTiming";

let spotifySdkPromise;

function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify);
  if (spotifySdkPromise) return spotifySdkPromise;

  spotifySdkPromise = new Promise((resolve, reject) => {
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      previousReady?.();
      if (window.Spotify?.Player) resolve(window.Spotify);
      else reject(new Error("Spotify Web Playback SDK failed to initialize."));
    };

    let script = document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.onerror = () => reject(new Error("Unable to load Spotify Web Playback SDK."));
      document.head.appendChild(script);
    }
  }).catch((error) => {
    spotifySdkPromise = null;
    throw error;
  });

  return spotifySdkPromise;
}

export class SpotifyPlayerAdapter {
  constructor(authProvider) {
    this.authProvider = authProvider;
    this.player = null;
    this.deviceId = null;
    this.initializePromise = null;
    this.readyResolver = null;
    this.readyRejector = null;
    this.readyTimeout = null;
    this.onEnded = null;
    this.onError = null;
    this.onProgress = null;
    this.onStateChange = null;
    this.onStatusChange = null;
    this.lastState = null;
    this.pendingUri = null;
    this.playRequest = null;
    this.progressTimer = null;
    this.progressBase = null;
    this.transferred = false;
    this.currentTrackUri = null;
    this.endReported = false;
  }

  setOnEnded(callback) { this.onEnded = callback; }
  setOnError(callback) { this.onError = callback; }
  setOnProgress(callback) { this.onProgress = callback; }
  setOnStateChange(callback) { this.onStateChange = callback; }
  setOnStatusChange(callback) { this.onStatusChange = callback; }

  reportError(error) {
    this.onStatusChange?.("error", error);
    this.onError?.(error);
  }

  async initialize() {
    if (this.deviceId) return this.deviceId;
    if (this.initializePromise) return this.initializePromise;

    this.onStatusChange?.("loading");
    const initialization = this.player ? this.reconnectPlayer() : this.createPlayer();
    this.initializePromise = initialization.catch(async (error) => {
      this.initializePromise = null;
      this.readyResolver = null;
      this.readyRejector = null;
      if (this.readyTimeout !== null) window.clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
      try {
        await this.player?.disconnect();
      } catch {
        // Discard a failed SDK instance before a later retry.
      }
      this.player = null;
      this.deviceId = null;
      this.reportError(error);
      throw error;
    });
    return this.initializePromise;
  }

  async createPlayer() {
    const Spotify = await loadSpotifySdk();
    return new Promise((resolve, reject) => {
      let ready = false;
      this.readyTimeout = window.setTimeout(() => {
        if (!ready) reject(new Error("Spotify player is taking too long to become ready."));
      }, 20000);

      this.player = new Spotify.Player({
        name: "Universal Music Web Player",
        volume: 0.8,
        getOAuthToken: async (callback) => {
          try {
            callback(await this.authProvider.getAccessToken());
          } catch (error) {
            this.reportError(error);
          }
        },
      });

      const rejectBeforeReady = (error) => {
        if (!ready) {
          window.clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
          reject(error);
        } else if (this.readyRejector) {
          this.readyRejector(error);
          this.reportError(error);
        } else {
          this.reportError(error);
        }
      };

      this.player.addListener("ready", ({ device_id: deviceId }) => {
        ready = true;
        if (this.readyTimeout !== null) window.clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
        this.deviceId = deviceId;
        this.transferred = false;
        this.onStatusChange?.("ready");
        this.readyResolver?.(deviceId);
        this.readyResolver = null;
        this.readyRejector = null;
        resolve(deviceId);
      });
      this.player.addListener("not_ready", ({ device_id: lostId }) => {
        // A discarded player's event must not clear the replacement device.
        if (!this.deviceId || lostId !== this.deviceId) return;
        this.deviceId = null;
        this.initializePromise = null;
        this.onStatusChange?.("loading");
      });
      this.player.addListener("player_state_changed", (state) => this.handlePlayerState(state));
      this.player.addListener("initialization_error", ({ message }) =>
        rejectBeforeReady(new Error(`Spotify player initialization failed: ${message}`))
      );
      this.player.addListener("authentication_error", ({ message }) =>
        rejectBeforeReady(new Error(`Spotify authentication failed: ${message}`))
      );
      this.player.addListener("account_error", ({ message }) =>
        rejectBeforeReady(new Error(
          `Spotify playback requires an eligible Spotify Premium account.${message ? ` ${message}` : ""}`
        ))
      );
      this.player.addListener("playback_error", ({ message }) =>
        this.reportError(new Error(`Spotify playback failed: ${message}`))
      );

      this.player.connect().then((connected) => {
        if (!connected && !ready) {
          rejectBeforeReady(new Error("Spotify player could not connect. Check that playback is available."));
        }
      }).catch(rejectBeforeReady);
    });
  }

  async reconnectPlayer() {
    return new Promise((resolve, reject) => {
      this.readyTimeout = window.setTimeout(() => {
        this.readyResolver = null;
        this.readyRejector = null;
        this.readyTimeout = null;
        reject(new Error("Spotify player is taking too long to reconnect."));
      }, 20000);
      this.readyResolver = (deviceId) => {
        if (this.readyTimeout !== null) window.clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
        resolve(deviceId);
      };
      this.readyRejector = (error) => {
        if (this.readyTimeout !== null) window.clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
        reject(error);
      };
      this.player.connect().then((connected) => {
        if (!connected && !this.deviceId) {
          this.readyResolver = null;
          this.readyRejector = null;
          if (this.readyTimeout !== null) window.clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
          reject(new Error("Spotify player could not reconnect."));
        }
      }).catch((error) => {
        this.readyResolver = null;
        this.readyRejector = null;
        if (this.readyTimeout !== null) window.clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
        reject(error);
      });
    });
  }

  handlePlayerState(state) {
    if (!state) {
      this.onStateChange?.(false);
      return;
    }

    const currentTrack = state.track_window?.current_track;
    const currentUri = currentTrack?.uri || null;
    if (currentUri && currentUri !== this.currentTrackUri) {
      this.currentTrackUri = currentUri;
      this.endReported = false;
    }

    const position = Math.max(0, Number(state.position) || 0);
    const duration = Math.max(0, Number(state.duration) || 0);
    this.syncProgress(position, duration, !state.paused);
    this.onStateChange?.(!state.paused);
    if (!state.paused && currentUri && currentUri === this.pendingUri) markPlaying("spotify");

    const justFinished = this.lastState && !this.lastState.paused && state.paused &&
      duration > 0 && position >= duration - 1000;
    if (justFinished && !this.endReported) {
      this.endReported = true;
      this.onEnded?.();
    }
    this.lastState = state;
  }

  syncProgress(position, duration, playing) {
    this.progressBase = { position, duration, at: performance.now() };
    this.onProgress?.({ currentTime: position / 1000, duration: duration / 1000 });
    window.clearInterval(this.progressTimer);
    this.progressTimer = null;
    if (!playing) return;
    // The SDK only emits state on changes, so advance the position locally.
    this.progressTimer = window.setInterval(() => {
      const { position: base, duration: total, at } = this.progressBase;
      const elapsed = Math.min(total, base + performance.now() - at);
      this.onProgress?.({ currentTime: elapsed / 1000, duration: total / 1000 });
    }, 500);
  }

  async load(track) {
    if (!(track.providerId || track.externalId)) throw new Error("This Spotify track has no ID.");
    await this.initialize();
  }

  async resetPlayer() {
    try {
      await this.player?.disconnect();
    } catch {
      // The stale instance is being discarded anyway.
    }
    this.player = null;
    this.deviceId = null;
    this.initializePromise = null;
    this.transferred = false;
  }

  async play(track) {
    const trackId = track.providerId || track.externalId;
    if (!trackId) throw new Error("This Spotify track has no ID.");
    const warm = Boolean(this.deviceId);
    if (!warm) markPlayback("spotify", "adapter init start");
    let deviceId = await this.initialize();
    markPlayback("spotify", warm ? "adapter ready (already warm)" : "adapter ready");
    this.pendingUri = `spotify:track:${trackId}`;
    // Must run inside the click gesture so the browser allows audio.
    await this.player?.activateElement?.();
    this.onStatusChange?.("loading");
    markPlayback("spotify", "load + play request sent", { command: true });
    const send = async () => {
      const request = fetch("/api/spotify/player/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, uri: `spotify:track:${trackId}`, transfer: !this.transferred }),
      });
      this.playRequest = request;
      const result = await request;
      return { response: result, payload: await result.json().catch(() => ({})) };
    };
    let { response, payload } = await send();
    if (!response.ok && /device not found/i.test(payload.error || "")) {
      // The SDK device is stale; a fresh player registers a new device.
      await this.resetPlayer();
      deviceId = await this.initialize();
      await this.player?.activateElement?.();
      ({ response, payload } = await send());
    }
    if (!response.ok) {
      const details = payload.error || "Unable to start Spotify playback.";
      const error = new Error(/premium/i.test(details)
        ? "Spotify playback requires an eligible Spotify Premium account."
        : details);
      this.reportError(error);
      throw error;
    }
    this.transferred = true;
    markPlayback("spotify", "request accepted");
    this.currentTrackUri = `spotify:track:${trackId}`;
    this.endReported = false;
    this.onStatusChange?.("ready");
  }

  async pause() {
    await this.control("pause", () => this.player?.pause());
    const base = this.progressBase;
    if (base) this.syncProgress(Math.min(base.duration, base.position + performance.now() - base.at), base.duration, false);
  }
  async resume() {
    await this.control("resume", () => this.player?.resume());
    const base = this.progressBase;
    if (base) this.syncProgress(base.position, base.duration, true);
  }
  async seek(seconds) {
    const target = Math.max(0, Number(seconds) || 0) * 1000;
    await this.control("seek", () => this.player?.seek(target), { position_ms: target });
    const playing = Boolean(this.progressTimer);
    this.syncProgress(target, this.progressBase?.duration || 0, playing);
  }

  // Playback may be active on another device, so the SDK alone can't be trusted.
  async control(action, sdkCall, body = {}) {
    const [sdk, api] = await Promise.allSettled([
      sdkCall(),
      fetch(`/api/spotify/player/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ]);
    const apiOk = api.status === "fulfilled" && api.value.ok;
    if (sdk.status === "rejected" && !apiOk) {
      throw new Error(`Spotify ${action} failed.`);
    }
  }
  async setVolume(value) { await this.player?.setVolume(Math.max(0, Math.min(1, Number(value) / 100))); }

  async getCurrentTime() {
    return ((await this.player?.getCurrentState())?.position || 0) / 1000;
  }

  async getDuration() {
    return ((await this.player?.getCurrentState())?.duration || 0) / 1000;
  }

  async stop() {
    this.pendingUri = null;
    window.clearInterval(this.progressTimer);
    this.progressTimer = null;
    // A play request still in flight would otherwise start after this pause.
    await this.playRequest?.catch(() => {});
    const [sdk, api] = await Promise.allSettled([
      this.player?.pause(),
      // Covers playback that is active on a device other than this SDK player.
      fetch("/api/spotify/player/pause", { method: "POST" }),
    ]);
    if (import.meta.env.DEV) {
      if (sdk.status === "rejected") console.warn("[spotify] SDK pause failed:", sdk.reason?.message);
      if (api.status === "rejected" || !api.value.ok) console.warn("[spotify] API pause failed:", api.value?.status ?? api.reason?.message);
    }
    this.onStateChange?.(false);
    this.onProgress?.({ currentTime: 0, duration: 0 });
  }

  async destroy() {
    await this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this.initializePromise = null;
    this.readyResolver = null;
    this.readyRejector = null;
    this.lastState = null;
  }
}
