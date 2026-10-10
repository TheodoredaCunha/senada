export class SoundCloudWidgetAdapter {
  constructor() {
    this.widget = null;
    this.ready = false;
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

    const src =
      "https://w.soundcloud.com/player/?url=" +
      encodeURIComponent(track.url) +
      "&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false";

    if (iframe.src !== src) {
      iframe.src = src;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    this.widget = window.SC.Widget(iframe);
    await new Promise((resolve) => {
      this.widget.bind(window.SC.Widget.Events.READY, () => {
        this.ready = true;
        this.widget.getDuration((duration) => {
          this.duration = duration || 0;
          this.emitProgress(0);
        });
        this.widget.bind(window.SC.Widget.Events.PLAY, () => this.onStateChange?.(true));
        this.widget.bind(window.SC.Widget.Events.PAUSE, () => this.onStateChange?.(false));
        this.widget.bind(window.SC.Widget.Events.FINISH, () => {
          this.onStateChange?.(false);
          this.emitProgress(this.duration);
          this.onEnded?.();
        });
        this.widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (event) => {
          const now = Date.now();
          if (now - this.lastProgressAt < 400) return;
          this.lastProgressAt = now;
          this.emitProgress(event.currentPosition || 0);
        });
        resolve();
      });
    });

    this.widget.play();
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
    this.widget?.pause();
    this.widget = null;
    this.ready = false;
    this.duration = 0;
    this.onStateChange?.(false);
    this.onProgress?.({ currentTime: 0, duration: 0 });
  }

  async setVolume(value) {
    this.widget?.setVolume(value);
  }
}