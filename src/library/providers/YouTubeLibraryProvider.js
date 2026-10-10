export class YouTubeLibraryProvider {
  constructor(authProvider, provider = "youtube") {
    this.authProvider = authProvider;
    this.provider = provider;
  }

  normalizeTrack(video) {
    const videoId = video.id?.videoId || video.id || video.snippet?.resourceId?.videoId;
    if (!videoId) return null;
    const snippet = video.snippet || {};
    const thumbnails = snippet.thumbnails || {};
    return {
      id: `${this.provider}:${videoId}`,
      provider: this.provider,
      providerId: videoId,
      title: snippet.title || "Unavailable YouTube video",
      artist: snippet.channelTitle || "YouTube",
      artwork: thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || "",
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      playable: true,
      duration: video.contentDetails?.duration || "",
    };
  }

  normalizePlaylist(playlist) {
    return {
      id: playlist.id,
      provider: this.provider,
      providerId: playlist.id,
      title: playlist.snippet?.title || "YouTube playlist",
      artwork:
        playlist.snippet?.thumbnails?.high?.url ||
        playlist.snippet?.thumbnails?.medium?.url ||
        playlist.snippet?.thumbnails?.default?.url ||
        "",
      trackCount: Number(playlist.contentDetails?.itemCount || 0),
      url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlist.id)}`,
    };
  }

  async requestJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load YouTube data.");
    return payload;
  }

  async getCurrentUser() {
    return this.authProvider.getCurrentUser();
  }

  async getLikedTracks() {
    const page = await this.getLikedTracksPage();
    return page.tracks;
  }

  async getLikedTracksPage({ pageToken, limit = 50 } = {}) {
    const parameters = new URLSearchParams({ limit: String(limit) });
    if (pageToken) parameters.set("pageToken", pageToken);
    const payload = await this.requestJson(`/api/youtube/likes/videos?${parameters}`);
    return {
      tracks: (Array.isArray(payload.videos) ? payload.videos : [])
        .map((video) => this.normalizeTrack(video))
        .filter(Boolean),
      nextPageToken: payload.nextPageToken || null,
    };
  }

  async getPlaylists() {
    const payload = await this.requestJson("/api/youtube/playlists");
    return (Array.isArray(payload.playlists) ? payload.playlists : []).map((item) =>
      this.normalizePlaylist(item)
    );
  }

  async getLikedPlaylists() {
    return this.getPlaylists();
  }

  async getPlaylistTracks(playlistId) {
    const payload = await this.requestJson(
      `/api/youtube/playlists/${encodeURIComponent(playlistId)}/videos`
    );
    return (Array.isArray(payload.videos) ? payload.videos : [])
      .map((video) => this.normalizeTrack(video))
      .filter(Boolean);
  }
}
