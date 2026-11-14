-- Strongly consistent product guards supplement the OAuth library's KV records.
CREATE TABLE hub_oauth_consent (
 handle_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, requested TEXT NOT NULL,
 expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(session_hash) REFERENCES hub_login_session(token_hash) ON DELETE CASCADE
);
CREATE TABLE hub_oauth_grant (
 id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL,
 client_id TEXT NOT NULL, resource TEXT NOT NULL, scopes TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, exchanged INTEGER NOT NULL DEFAULT 0,
 revoked_at INTEGER,
 FOREIGN KEY(session_hash) REFERENCES hub_login_session(token_hash) ON DELETE CASCADE,
 FOREIGN KEY(issuer,subject) REFERENCES hub_login_principal(issuer,subject)
);
CREATE INDEX hub_oauth_grant_owner ON hub_oauth_grant(issuer,subject);
CREATE TABLE hub_oauth_rate (id INTEGER PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);

-- Persist before returning a token so revocation does not depend on KV propagation.
CREATE TABLE hub_oauth_token (
 token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, client_id TEXT NOT NULL,
 FOREIGN KEY(grant_id) REFERENCES hub_oauth_grant(id) ON DELETE CASCADE
);
CREATE INDEX hub_oauth_token_grant ON hub_oauth_token(grant_id);
