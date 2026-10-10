import { markPlayback, markPlaying } from "../playbackTiming";

let youtubeApiPromise;

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame Player API failed to initialize."));
    };

    let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Unable to load the YouTube IFrame Player API."));
      document.head.appendChild(script);
    }
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}

export class YouTubePlayerAdapter {
  constructor(containerId = "youtube-player") {
    this.containerId = containerId;
    this.player = null;
    this.readyPromise = null;
    this.onEnded = null;
    this.onError = null;
    this.onProgress = null;
    this.onStateChange = null;
    this.progressTimer = null;
    this.ready = false;
  }

  setOnEnded(callback) {
    this.onEnded = callback;
  }

  setOnError(callback) {
    this.onError = callback;
  }

  setOnProgress(callback) {
    this.onProgress = callback;
  }

  setOnStateChange(callback) {
    this.onStateChange = callback;
  }

  async ensurePlayer() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = this.createPlayer().catch((error) => {
      this.readyPromise = null;
      this.player = null;
      throw error;
    });
    return this.readyPromise;
  }

  async createPlayer() {
    const YT = await loadYouTubeIframeApi();
    const container = await this.waitForContainer();
    if (!container) throw new Error("YouTube player container is missing.");

    return new Promise((resolve, reject) => {
      try {
        this.player = new YT.Player(container, {
          width: "356",
          height: "200",
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              resolve();
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.BUFFERING) markPlayback("youtube", "buffering");
              if (event.data === YT.PlayerState.PLAYING) {
                this.onStateChange?.(true);
                markPlaying("youtube");
                this.startProgressUpdates();
              } else {
                this.onStateChange?.(false);
                this.stopProgressUpdates();
                this.reportProgress();
              }
              if (event.data === YT.PlayerState.ENDED) this.onEnded?.();
            },
            onError: (event) => {
              if (import.meta.env.DEV) console.warn(`[youtube] onError code ${event.data} at ${window.location.origin}`);
              const messages = {
                2: "YouTube rejected the video ID.",
                5: "This video cannot be played in the embedded player.",
                100: "This YouTube video is unavailable or has been removed.",
                101: "The video owner does not allow embedded playback.",
                150: "The video owner does not allow embedded playback.",
                153: "YouTube could not verify this page's origin or referrer for embedded playback.",
              };
              const error = new Error(messages[event.data] || "YouTube playback failed.");
              this.stopProgressUpdates();
              this.onStateChange?.(false);
              this.onError?.(error);
            },
          },
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async waitForContainer(timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs;
    let container = document.getElementById(this.containerId);
    while (!container && performance.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      container = document.getElementById(this.containerId);
    }
    return container;
  }

  async initialize() {
    await this.ensurePlayer();
  }

  async load(track) {
    const videoId = track.providerId || track.externalId;
    if (!videoId) throw new Error("This YouTube track has no video ID.");
    await this.ensurePlayer();
    this.player.loadVideoById(videoId);
  }

  async play(track) {
    const videoId = track.providerId || track.externalId;
    if (!videoId) throw new Error("This YouTube track has no video ID.");
    const warm = this.ready;
    if (!warm) markPlayback("youtube", "adapter init start");
    await this.ensurePlayer();
    markPlayback("youtube", warm ? "adapter ready (already warm)" : "adapter ready");
    markPlayback("youtube", "load + play command sent", { command: true });
    this.player.loadVideoById(videoId);
  }

  async startProgressUpdates() {
    this.stopProgressUpdates();
    this.progressTimer = window.setInterval(() => this.reportProgress(), 500);
  }

  stopProgressUpdates() {
    if (this.progressTimer !== null) window.clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  reportProgress() {
    if (!this.player) return;
    this.onProgress?.({
      currentTime: this.player.getCurrentTime?.() || 0,
      duration: this.player.getDuration?.() || 0,
    });
  }

  async pause() {
    this.player?.pauseVideo();
  }

  async resume() {
    this.player?.playVideo();
  }

  async setVolume(value) {
    this.player?.setVolume?.(Math.max(0, Math.min(100, Number(value) || 0)));
  }

  async seek(seconds) {
    this.player?.seekTo(Math.max(0, Number(seconds) || 0), true);
    this.reportProgress();
  }

  async stop() {
    this.stopProgressUpdates();
    this.player?.pauseVideo();
    this.onStateChange?.(false);
    this.onProgress?.({ currentTime: 0, duration: 0 });
  }

  async destroy() {
    this.stopProgressUpdates();
    this.player?.destroy();
    this.ready = false;
    this.player = null;
    this.readyPromise = null;
  }
}
