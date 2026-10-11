import express from "express";
import { db, newId, PROVIDERS, transaction } from "./db.js";
import { requireUser } from "./appAuth.js";

const MAX_PLAYLISTS = 200;
const MAX_TRACKS = 5000;

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const httpsUrl = (value) => {
  const url = text(value, 2048);
  return /^https:\/\//i.test(url) ? url : "";
};

const toPlaylist = (row, extra = {}) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  artwork: row.artwork,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...extra,
});

const toTrack = (row) => ({
  id: row.id,
  provider: row.provider,
  providerTrackId: row.provider_track_id,
  title: row.title,
  artist: row.artist,
  album: row.album,
  artwork: row.artwork,
  url: row.url,
  duration: row.duration,
  position: row.position,
  addedAt: row.added_at,
});

// Returns the playlist only when it belongs to the signed-in user; anything else looks like "not found".
function ownedPlaylist(req, res) {
  const row = db.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) res.status(404).json({ error: "Playlist not found." });
  return row;
}

function guard(handler) {
  return (req, res) => {
    try {
      return handler(req, res);
    } catch (error) {
      console.error("[playlists] database error:", error.message);
      return res.status(500).json({ error: "Unable to complete that playlist request." });
    }
  };
}

export function createPlaylistRouter() {
  const router = express.Router();
  router.use(requireUser);

  router.get("/", guard((req, res) => {
    const rows = db.prepare(`SELECT playlists.*,
        (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id) AS track_count
      FROM playlists WHERE user_id = ? ORDER BY created_at ASC`).all(req.user.id);
    res.json({ playlists: rows.map((row) => toPlaylist(row, { trackCount: row.track_count })) });
  }));

  router.post("/", guard((req, res) => {
    const name = text(req.body?.name, 100);
    if (!name) return res.status(400).json({ error: "A playlist name is required." });
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM playlists WHERE user_id = ?").get(req.user.id);
    if (count >= MAX_PLAYLISTS) return res.status(400).json({ error: "Playlist limit reached." });

    const now = Date.now();
    const id = newId();
    db.prepare(`INSERT INTO playlists (id, user_id, name, description, artwork, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, req.user.id, name, text(req.body?.description, 500), httpsUrl(req.body?.artwork), now, now);
    const row = db.prepare("SELECT * FROM playlists WHERE id = ?").get(id);
    return res.status(201).json({ playlist: toPlaylist(row, { trackCount: 0 }) });
  }));

  router.get("/:id", guard((req, res) => {
    const row = ownedPlaylist(req, res);
    if (!row) return undefined;
    const tracks = db.prepare("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC").all(row.id);
    return res.json({ playlist: toPlaylist(row, { trackCount: tracks.length }), tracks: tracks.map(toTrack) });
  }));

  router.patch("/:id", guard((req, res) => {
    const row = ownedPlaylist(req, res);
    if (!row) return undefined;
    const body = req.body || {};
    const name = body.name === undefined ? row.name : text(body.name, 100);
    if (!name) return res.status(400).json({ error: "A playlist name is required." });
    db.prepare("UPDATE playlists SET name = ?, description = ?, artwork = ?, updated_at = ? WHERE id = ?").run(
      name,
      body.description === undefined ? row.description : text(body.description, 500),
      body.artwork === undefined ? row.artwork : httpsUrl(body.artwork),
      Date.now(),
      row.id
    );
    return res.json({ playlist: toPlaylist(db.prepare("SELECT * FROM playlists WHERE id = ?").get(row.id)) });
  }));

  router.delete("/:id", guard((req, res) => {
    const row = ownedPlaylist(req, res);
    if (!row) return undefined;
    db.prepare("DELETE FROM playlists WHERE id = ?").run(row.id);
    return res.json({ ok: true });
  }));

  router.post("/:id/tracks", guard((req, res) => {
    const row = ownedPlaylist(req, res);
    if (!row) return undefined;
    const body = req.body || {};
    const providerTrackId = text(body.providerTrackId, 200);
    const title = text(body.title, 300);
    if (!PROVIDERS.includes(body.provider) || !providerTrackId || !title) {
      return res.status(400).json({ error: "A provider, track ID, and title are required." });
    }
    const stats = db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(position), -1) AS last FROM playlist_tracks WHERE playlist_id = ?").get(row.id);
    if (stats.count >= MAX_TRACKS) return res.status(400).json({ error: "This playlist is full." });
    const duplicate = db.prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND provider = ? AND provider_track_id = ?")
      .get(row.id, body.provider, providerTrackId);
    if (duplicate) return res.status(409).json({ error: "That track is already in this playlist." });

    const id = newId();
    const now = Date.now();
    transaction(() => {
      db.prepare(`INSERT INTO playlist_tracks
          (id, playlist_id, provider, provider_track_id, title, artist, album, artwork, url, duration, position, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, row.id, body.provider, providerTrackId, title,
        text(body.artist, 300), text(body.album, 300), httpsUrl(body.artwork), httpsUrl(body.url),
        text(String(body.duration ?? ""), 40), stats.last + 1, now
      );
      db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, row.id);
    });
    return res.status(201).json({ track: toTrack(db.prepare("SELECT * FROM playlist_tracks WHERE id = ?").get(id)) });
  }));

  // Registered before the :trackId route so "reorder" is never read as a track ID.
  router.patch("/:id/tracks/reorder", guard((req, res) => {
    const row = ownedPlaylist(req, res);
    if (!row) return undefined;
    const requested = req.body?.trackIds;
    const existing = db.prepare("SELECT id FROM playlist_tracks WHERE playlist_id = ?").all(row.id).map((track) => track.id);
    const valid = Array.isArray(requested)
      && requested.length === existing.length
      && new Set(requested).size === requested.length
      && requested.every((id) => existing.includes(id));
    if (!valid) return res.status(400).json({ error: "trackIds must list every track in the playlist exactly once." });

    transaction(() => {
      const update = db.prepare("UPDATE playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?");
      requested.forEach((id, index) => update.run(index, id, row.id));
      db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(Date.now(), row.id);
    });
    const tracks = db.prepare("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC").all(row.id);
    return res.json({ tracks: tracks.map(toTrack) });
  }));

  router.delete("/:id/tracks/:trackId", guard((req, res) => {
    const row = ownedPlaylist(req, res);
    if (!row) return undefined;
    const removed = transaction(() => {
      const result = db.prepare("DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?").run(req.params.trackId, row.id);
      if (result.changes === 0) return false;
      const remaining = db.prepare("SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC").all(row.id);
      const update = db.prepare("UPDATE playlist_tracks SET position = ? WHERE id = ?");
      remaining.forEach((track, index) => update.run(index, track.id));
      db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(Date.now(), row.id);
      return true;
    });
    if (!removed) return res.status(404).json({ error: "Track not found in this playlist." });
    return res.json({ ok: true });
  }));

  return router;
}
