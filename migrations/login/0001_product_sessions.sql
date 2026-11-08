-- This database is product-local. Never reuse the Vocs Login identity database.
CREATE TABLE hub_login_transaction (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL UNIQUE,
  verifier TEXT NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed IN (0, 1)),
  expires_at INTEGER NOT NULL
);
CREATE INDEX hub_login_transaction_expiry ON hub_login_transaction(expires_at);
CREATE TABLE hub_login_principal (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  disabled_at INTEGER,
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE hub_login_session (
  token_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (issuer, subject) REFERENCES hub_login_principal(issuer, subject)
);
CREATE INDEX hub_login_session_browser ON hub_login_session(browser_hash);
CREATE INDEX hub_login_session_expiry ON hub_login_session(expires_at);
-- Intentionally empty and not writable by any HTTP endpoint. Login grants nothing.
-- Future capability integration must recheck these grants on every request.
CREATE TABLE hub_login_permission (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (issuer, subject, permission),
  FOREIGN KEY (issuer, subject) REFERENCES hub_login_principal(issuer, subject)
);
CREATE TABLE hub_login_rate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
