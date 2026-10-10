export class SoundCloudLibraryProvider {
  constructor(authProvider, provider = "soundcloud") {
    this.authProvider = authProvider;
    this.provider = provider;
  }

  normalizeTrack(track) {
    const user = track.user || {};
    const artwork =
      track.artwork_url ||
      track.user?.avatar_url ||
      "https://soundcloud.com/favicon.ico";

    return {
      id: String(track.id),
      provider: this.provider,
      providerId: String(track.id),
      title: track.title || "Untitled track",
      artist: user.username || track.user_name || "SoundCloud",
      artwork,
      url: track.permalink_url || track.uri || track.stream_url || "",
      playable: Boolean(track.permalink_url || track.stream_url || track.uri),
    };
  }

  normalizePlaylist(playlist) {
    return {
      id: String(playlist.id),
      provider: this.provider,
      providerId: String(playlist.id),
      title: playlist.title || "SoundCloud playlist",
      artwork:
        playlist.artwork_url ||
        playlist.tracks?.[0]?.artwork_url ||
        "https://soundcloud.com/favicon.ico",
      trackCount: playlist.track_count || playlist.tracks?.length || 0,
      url: playlist.permalink_url || playlist.uri || "",
    };
  }

  async requestJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload.error || "Unable to load SoundCloud data.";
      throw new Error(
        message === "SoundCloud connection expired." ? "SoundCloud connection expired." : message
      );
    }

    return response.json();
  }

  async getCurrentUser() {
    return this.authProvider.getCurrentUser();
  }

  async getLikedTracks() {
    const payload = await this.requestJson("/api/soundcloud/likes/tracks");
    const likes = Array.isArray(payload.tracks) ? payload.tracks : [];

    return likes
      .map((item) => (item.track ? item.track : item))
      .filter(Boolean)
      .map((track) => this.normalizeTrack(track));
  }

  async getLikedPlaylists() {
    const payload = await this.requestJson("/api/soundcloud/playlists");
    const playlists = Array.isArray(payload.playlists) ? payload.playlists : [];
    return playlists.map((playlist) => this.normalizePlaylist(playlist));
  }

  async getPlaylists() {
    return this.getLikedPlaylists();
  }

  async getPlaylistTracks(playlistId) {
    const payload = await this.requestJson(`/api/soundcloud/playlists/${playlistId}/tracks`);
    const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
    return tracks.map((track) => this.normalizeTrack(track));
  }
}
