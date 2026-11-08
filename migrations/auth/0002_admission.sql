-- Invite management is an operator-only database operation, not a public endpoint.
CREATE TABLE hub_invitation (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  expires_at INTEGER,
  revoked_at INTEGER
);
-- A provider subject must never bind to two Vocs accounts.
CREATE UNIQUE INDEX account_provider_subject ON account(providerId, accountId);
CREATE TABLE hub_rate_limit (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX hub_rate_limit_expiry ON hub_rate_limit(expires_at);
