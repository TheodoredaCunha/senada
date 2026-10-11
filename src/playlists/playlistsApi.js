// Persistent app playlists, stored per Universal Music user on the backend.
async function request(path, options = {}) {
  const response = await fetch(`/api/playlists${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Playlist request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

const withTitle = (playlist) => ({ ...playlist, title: playlist.name });

// Same shape the library providers produce, so UnifiedPlayer and the queue play it unchanged.
export function toPlayerTrack(track) {
  return {
    id: track.provider === "soundcloud" ? track.providerTrackId : `${track.provider}:${track.providerTrackId}`,
    provider: track.provider,
    providerId: track.providerTrackId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.artwork,
    url: track.url,
    uri: track.provider === "spotify" ? `spotify:track:${track.providerTrackId}` : undefined,
    playable: true,
    duration: track.duration,
    playlistTrackId: track.id,
  };
}

export const playlistsApi = {
  async list() {
    return (await request("")).playlists.map(withTitle);
  },
  async create(name) {
    return withTitle((await request("", { method: "POST", body: { name } })).playlist);
  },
  async get(id) {
    const payload = await request(`/${encodeURIComponent(id)}`);
    return { playlist: withTitle(payload.playlist), tracks: payload.tracks.map(toPlayerTrack) };
  },
  async rename(id, name) {
    return withTitle((await request(`/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } })).playlist);
  },
  remove(id) {
    return request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async addTrack(id, track) {
    const payload = await request(`/${encodeURIComponent(id)}/tracks`, {
      method: "POST",
      body: {
        provider: track.provider,
        providerTrackId: track.providerId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.artwork,
        url: track.url,
        duration: track.duration,
      },
    });
    return toPlayerTrack(payload.track);
  },
  removeTrack(id, playlistTrackId) {
    return request(`/${encodeURIComponent(id)}/tracks/${encodeURIComponent(playlistTrackId)}`, { method: "DELETE" });
  },
  async reorder(id, playlistTrackIds) {
    const payload = await request(`/${encodeURIComponent(id)}/tracks/reorder`, {
      method: "PATCH",
      body: { trackIds: playlistTrackIds },
    });
    return payload.tracks.map(toPlayerTrack);
  },
};
