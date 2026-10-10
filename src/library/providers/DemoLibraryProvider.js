import { demoPlaylists } from "../../data/tracks";

export class DemoLibraryProvider {
  constructor(provider) {
    this.provider = provider;
  }

  async getLikedTracks() {
    const playlist = demoPlaylists.find(
      (item) => item.provider === this.provider && item.title.includes("Liked")
    );
    return playlist?.tracks ?? [];
  }

  async getPlaylists() {
    return demoPlaylists.filter(
      (playlist) => playlist.provider === this.provider
    );
  }
}