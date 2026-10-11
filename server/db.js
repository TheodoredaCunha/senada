import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.DATABASE_DIR
  ? path.resolve(process.env.DATABASE_DIR)
  : path.join(serverDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const PROVIDERS = ["spotify", "youtube", "soundcloud"];

const db = new DatabaseSync(process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(dataDir, "universal-music.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// Append-only: add a new entry instead of editing an applied one.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    google_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE app_sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_app_sessions_user ON app_sessions(user_id);

  CREATE TABLE provider_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('spotify', 'youtube', 'soundcloud')),
    provider_user_id TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect')),
    profile TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (user_id, provider)
  );

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    artwork TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_playlists_user ON playlists(user_id);

  CREATE TABLE playlist_tracks (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('spotify', 'youtube', 'soundcloud')),
    provider_track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    artwork TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    UNIQUE (playlist_id, provider, provider_track_id)
  );
  CREATE INDEX idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);
  `,
];

function migrate() {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const applied = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1;
    if (version <= applied) return;
    transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, Date.now());
    });
  });
}

export function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

migrate();

export const newId = () => crypto.randomUUID();
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export { db };
