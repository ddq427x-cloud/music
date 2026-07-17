ALTER TABLE music_sources ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'template';
ALTER TABLE music_sources ADD COLUMN adapter_config TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_music_sources_kind ON music_sources(user_id, source_kind, platform);
