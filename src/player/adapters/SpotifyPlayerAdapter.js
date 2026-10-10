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
        this.onStatusChange?.("ready");
        this.readyResolver?.(deviceId);
        this.readyResolver = null;
        this.readyRejector = null;
        resolve(deviceId);
      });
      this.player.addListener("not_ready", () => {
        if (!this.deviceId) return;
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
    this.onProgress?.({ currentTime: position / 1000, duration: duration / 1000 });
    this.onStateChange?.(!state.paused);

    const justFinished = this.lastState && !this.lastState.paused && state.paused &&
      duration > 0 && position >= duration - 1000;
    if (justFinished && !this.endReported) {
      this.endReported = true;
      this.onEnded?.();
    }
    this.lastState = state;
  }

  async load(track) {
    if (!(track.providerId || track.externalId)) throw new Error("This Spotify track has no ID.");
    await this.initialize();
  }

  async play(track) {
    const trackId = track.providerId || track.externalId;
    if (!trackId) throw new Error("This Spotify track has no ID.");
    const deviceId = await this.initialize();
    this.onStatusChange?.("loading");
    const response = await fetch("/api/spotify/player/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, uri: `spotify:track:${trackId}` }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = payload.error || "Unable to start Spotify playback.";
      const error = new Error(/premium/i.test(details)
        ? "Spotify playback requires an eligible Spotify Premium account."
        : details);
      this.reportError(error);
      throw error;
    }
    this.currentTrackUri = `spotify:track:${trackId}`;
    this.endReported = false;
    this.onStatusChange?.("ready");
  }

  async pause() { await this.player?.pause(); }
  async resume() { await this.player?.resume(); }
  async seek(seconds) { await this.player?.seek(Math.max(0, Number(seconds) || 0) * 1000); }
  async setVolume(value) { await this.player?.setVolume(Math.max(0, Math.min(1, Number(value) / 100))); }

  async getCurrentTime() {
    return ((await this.player?.getCurrentState())?.position || 0) / 1000;
  }

  async getDuration() {
    return ((await this.player?.getCurrentState())?.duration || 0) / 1000;
  }

  async stop() {
    await this.player?.pause();
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
