export class NoOpAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  async play() {
    throw new Error(
      `${this.provider} playback is not implemented yet. The track is visible in the unified library, but playback is disabled in this starter.`
    );
  }

  async pause() {}
  async stop() {}
  async setVolume() {}
}