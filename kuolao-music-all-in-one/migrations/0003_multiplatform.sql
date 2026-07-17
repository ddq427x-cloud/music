PRAGMA foreign_keys = OFF;

ALTER TABLE music_sources ADD COLUMN platform TEXT NOT NULL DEFAULT 'kuwo';
ALTER TABLE music_sources ADD COLUMN search_url_template TEXT NOT NULL DEFAULT '';
UPDATE music_sources SET platform='kuwo' WHERE platform IS NULL OR platform='';

CREATE TABLE favorites_new (
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'kuwo',
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  artwork TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, platform, song_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO favorites_new (user_id,platform,song_id,title,artist,album,artwork,created_at)
SELECT user_id,'kuwo',song_id,title,artist,album,artwork,created_at FROM favorites;
DROP TABLE favorites;
ALTER TABLE favorites_new RENAME TO favorites;
CREATE INDEX idx_favorites_user_created ON favorites(user_id, created_at DESC);

CREATE TABLE playlist_songs_new (
  playlist_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'kuwo',
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  artwork TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, platform, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);
INSERT INTO playlist_songs_new (playlist_id,platform,song_id,title,artist,album,artwork,sort_order,created_at)
SELECT playlist_id,'kuwo',song_id,title,artist,album,artwork,sort_order,created_at FROM playlist_songs;
DROP TABLE playlist_songs;
ALTER TABLE playlist_songs_new RENAME TO playlist_songs;
CREATE INDEX idx_playlist_songs_order ON playlist_songs(playlist_id, sort_order ASC, created_at ASC);

CREATE INDEX idx_music_sources_user_platform ON music_sources(user_id, platform, is_selected DESC);
PRAGMA foreign_keys = ON;
