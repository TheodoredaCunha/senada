export class SpotifyLibraryProvider {
  constructor(authProvider, provider = "spotify") {
    this.authProvider = authProvider;
    this.provider = provider;
  }

  normalizeTrack(savedTrack) {
    const track = savedTrack.track || savedTrack;
    if (!track.id) return null;
    const album = track.album || {};
    return {
      id: `${this.provider}:${track.id}`,
      provider: this.provider,
      providerId: track.id,
      title: track.name || "Untitled track",
      artist: (track.artists || []).map((artist) => artist.name).join(", ") || "Spotify",
      album: album.name || "",
      artwork: album.images?.[0]?.url || "",
      url: track.external_urls?.spotify || "",
      uri: track.uri || `spotify:track:${track.id}`,
      playable: track.is_playable !== false,
      duration: Number(track.duration_ms || 0) / 1000,
    };
  }

  async requestJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load Spotify data.");
    return payload;
  }

  async getCurrentUser() {
    return this.authProvider.getCurrentUser();
  }

  async getLikedTracks() {
    const page = await this.getLikedTracksPage();
    return page.tracks;
  }

  async getLikedTracksPage({ offset = 0, limit = 50 } = {}) {
    const parameters = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    const payload = await this.requestJson(`/api/spotify/saved-tracks?${parameters}`);
    return {
      tracks: (Array.isArray(payload.items) ? payload.items : [])
        .map((item) => this.normalizeTrack(item))
        .filter(Boolean),
      nextOffset: Number.isInteger(payload.nextOffset) ? payload.nextOffset : null,
    };
  }

  async getPlaylists() {
    return [];
  }

  async getPlaylistTracks() {
    return [];
  }
}
