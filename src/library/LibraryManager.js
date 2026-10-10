export class LibraryManager {
  constructor(providers) {
    this.providers = providers;
  }

  async getCurrentUser(provider) {
    return this.providers[provider].getCurrentUser?.();
  }

  async getLikedTracks(provider) {
    return this.providers[provider].getLikedTracks();
  }

  async getLikedTracksPage(provider, options) {
    return this.providers[provider].getLikedTracksPage?.(options);
  }

  async getLikedPlaylists(provider) {
    return this.providers[provider].getLikedPlaylists?.() ?? [];
  }

  async getPlaylists(provider) {
    return this.providers[provider].getPlaylists();
  }

  async getPlaylistTracks(provider, playlistId) {
    return this.providers[provider].getPlaylistTracks?.(playlistId) ?? [];
  }
}