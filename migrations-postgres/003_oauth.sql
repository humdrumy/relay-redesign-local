CREATE TABLE IF NOT EXISTS relay_oauth_requests (
 id TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS relay_oauth_codes (
 hash TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS relay_oauth_tokens (
 access_hash TEXT PRIMARY KEY, refresh_hash TEXT UNIQUE NOT NULL,
 body TEXT NOT NULL, access_expires_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
