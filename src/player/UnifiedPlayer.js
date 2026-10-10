export class UnifiedPlayer {
  constructor(adapters) {
    this.adapters = adapters;
    this.current = null;
    this.queue = [];
    this.queueIndex = -1;
    this.onTrackChange = null;
    this.onProgress = null;
    this.onPlayingChange = null;
    this.playing = false;

    for (const [provider, adapter] of Object.entries(adapters)) {
      adapter.setOnProgress?.((progress) => {
        if (this.current?.provider === provider) this.onProgress?.(progress);
      });
      adapter.setOnStateChange?.((playing) => {
        if (this.current?.provider !== provider) return;
        this.playing = playing;
        this.onPlayingChange?.(playing);
      });
      adapter.setOnEnded?.(() => {
        if (this.current?.provider !== provider) return;
        this.next().catch((error) => adapter.onError?.(error));
      });
    }
  }

  setOnTrackChange(callback) {
    this.onTrackChange = callback;
  }

  setOnProgress(callback) {
    this.onProgress = callback;
  }

  setOnPlayingChange(callback) {
    this.onPlayingChange = callback;
  }

  setQueue(tracks) {
    this.queue = [...tracks];
    this.queueIndex = this.current
      ? this.queue.findIndex((track) => track.id === this.current.id)
      : -1;
  }

  async play(track) {
    const adapter = this.adapters[track.provider];
    if (!adapter) throw new Error(`No player for ${track.provider}`);
    if (this.current && this.current.provider !== track.provider) {
      await this.adapters[this.current.provider]?.stop();
    }
    const queueIndex = this.queue.findIndex((item) => item.id === track.id);
    if (queueIndex >= 0) this.queueIndex = queueIndex;
    else {
      this.queue = [track];
      this.queueIndex = 0;
    }
    this.current = track;
    this.playing = true;
    this.onProgress?.({ currentTime: 0, duration: 0 });
    this.onTrackChange?.(track);
    this.onPlayingChange?.(true);
    try {
      return await adapter.play(track);
    } catch (error) {
      this.playing = false;
      this.onPlayingChange?.(false);
      throw error;
    }
  }

  async togglePlayback() {
    if (!this.current) return;
    if (this.playing) {
      await this.adapters[this.current.provider]?.pause();
      this.playing = false;
      this.onPlayingChange?.(false);
    } else {
      await this.adapters[this.current.provider]?.resume?.();
      this.playing = true;
      this.onPlayingChange?.(true);
    }
  }

  async seek(seconds) {
    if (!this.current) return;
    return this.adapters[this.current.provider]?.seek?.(seconds);
  }

  async next() {
    if (this.queueIndex < 0) return false;
    const nextTrack = this.queue[this.queueIndex + 1];
    if (!nextTrack) {
      this.playing = false;
      this.onPlayingChange?.(false);
      return false;
    }
    await this.play(nextTrack);
    return true;
  }

  async previous() {
    const previousTrack = this.queue[this.queueIndex - 1];
    if (!previousTrack) return false;
    await this.play(previousTrack);
    return true;
  }

  async pause() {
    if (!this.current) return;
    await this.adapters[this.current.provider]?.pause();
    this.playing = false;
    this.onPlayingChange?.(false);
  }

  async stop() {
    if (!this.current) return;
    const result = await this.adapters[this.current.provider]?.stop();
    this.current = null;
    this.playing = false;
    this.onTrackChange?.(null);
    this.onPlayingChange?.(false);
    this.onProgress?.({ currentTime: 0, duration: 0 });
    return result;
  }

  async setVolume(value) {
    if (!this.current) return;
    return this.adapters[this.current.provider]?.setVolume(value);
  }
}