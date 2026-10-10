import { markPlayback, markPlaying } from "../playbackTiming";

const WIDGET_OPTIONS = {
  hide_related: true,
  show_comments: false,
  show_user: true,
  show_reposts: false,
  visual: false,
};

export class SoundCloudWidgetAdapter {
  constructor() {
    this.widget = null;
    this.widgetPromise = null;
    this.loadedUrl = null;
    this.playToken = 0;
    this.onProgress = null;
    this.onStateChange = null;
    this.onEnded = null;
    this.duration = 0;
    this.lastProgressAt = 0;
  }

  setOnProgress(callback) {
    this.onProgress = callback;
  }

  setOnStateChange(callback) {
    this.onStateChange = callback;
  }

  setOnEnded(callback) {
    this.onEnded = callback;
  }

  async play(track) {
    if (!window.SC?.Widget) {
      throw new Error("SoundCloud Widget API has not loaded yet.");
    }

    const iframe = document.getElementById("soundcloud-widget");
    if (!iframe) throw new Error("SoundCloud player iframe is missing.");

    const token = ++this.playToken;
    const warm = Boolean(this.widgetPromise);
    if (!warm) {
      markPlayback("soundcloud", "adapter init start");
      this.widgetPromise = this.createWidget(iframe, track).catch((error) => {
        this.widgetPromise = null;
        this.widget = null;
        throw error;
      });
    }
    await this.widgetPromise;
    markPlayback("soundcloud", warm ? "adapter ready (already warm)" : "adapter ready");
    if (token !== this.playToken) return;

    if (this.loadedUrl !== track.url) {
      markPlayback("soundcloud", "load start");
      this.loadedUrl = track.url;
      await new Promise((resolve) => {
        this.widget.load(track.url, { ...WIDGET_OPTIONS, auto_play: false, callback: resolve });
      });
      if (token !== this.playToken) return;
    }
    markPlayback("soundcloud", "track loaded");

    this.widget.getDuration((duration) => {
      this.duration = duration || 0;
      this.emitProgress(0);
    });
    this.widget.play();
    markPlayback("soundcloud", "play command sent", { command: true });
  }

  createWidget(iframe, track) {
    this.loadedUrl = track.url;
    iframe.src =
      "https://w.soundcloud.com/player/?url=" +
      encodeURIComponent(track.url) +
      "&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false";
    this.widget = window.SC.Widget(iframe);
    return new Promise((resolve) => {
      this.widget.bind(window.SC.Widget.Events.READY, () => {
        this.bindWidgetEvents();
        resolve();
      });
    });
  }

  bindWidgetEvents() {
    const { Events } = window.SC.Widget;
    this.widget.bind(Events.PLAY, () => {
      this.onStateChange?.(true);
      markPlaying("soundcloud");
    });
    this.widget.bind(Events.PAUSE, () => this.onStateChange?.(false));
    this.widget.bind(Events.FINISH, () => {
      this.onStateChange?.(false);
      this.emitProgress(this.duration);
      this.onEnded?.();
    });
    this.widget.bind(Events.PLAY_PROGRESS, (event) => {
      const now = Date.now();
      if (now - this.lastProgressAt < 400) return;
      this.lastProgressAt = now;
      this.emitProgress(event.currentPosition || 0);
    });
  }

  emitProgress(position) {
    this.onProgress?.({
      currentTime: Math.max(0, Number(position) || 0) / 1000,
      duration: Math.max(0, Number(this.duration) || 0) / 1000,
    });
  }

  async pause() {
    this.widget?.pause();
  }

  async resume() {
    this.widget?.play();
  }

  async seek(seconds) {
    this.widget?.seekTo(Math.max(0, Number(seconds) || 0) * 1000);
  }

  async stop() {
    this.playToken += 1;
    this.widget?.pause();
    this.duration = 0;
    this.onStateChange?.(false);
    this.onProgress?.({ currentTime: 0, duration: 0 });
  }

  async setVolume(value) {
    this.widget?.setVolume(value);
  }
}