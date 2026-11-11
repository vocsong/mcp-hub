-- Operator grants remain in hub_login_permission. No HTTP API writes them.
-- Manual, short-lived capabilities, not an OAuth authorization server.
CREATE TABLE hub_client_token (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  session_hash TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  client_id TEXT NOT NULL CHECK (client_id IN ('dots', 'vocs-code')),
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (session_hash) REFERENCES hub_login_session(token_hash) ON DELETE CASCADE,
  FOREIGN KEY (issuer, subject) REFERENCES hub_login_principal(issuer, subject)
);
CREATE INDEX hub_client_token_owner ON hub_client_token(issuer, subject);
CREATE INDEX hub_client_token_expiry ON hub_client_token(expires_at);
