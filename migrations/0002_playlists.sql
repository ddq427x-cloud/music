PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_playlists_user_updated ON playlists(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  artwork TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_order ON playlist_songs(playlist_id, sort_order ASC, created_at ASC);
