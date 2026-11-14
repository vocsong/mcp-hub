# Account connections and native clients

## First implementation slice

`GET /api/connections` returns a versioned, read-only account connection snapshot.
By default it requires a valid same-origin Hub browser session and
`dashboard:manage`. The disabled native-token path described below uses the same
current Hub account permissions.
The capability feature flag must already be enabled. It creates no grants,
tokens, provider calls, subscriptions, local processes, or database rows.

The server reads current permissions from primary storage on every request. A
connection appears only when this account has at least one allowed scope for it.
Production and staging use their own fixed identity realms and resource URLs.
The initial catalog contains only the existing OpenRouter resource; it does not
pretend arbitrary MCP connections or a per-user connection editor already exist.

Each entry supplies `id`, `name`, `transport`, `resource`,
`authorizationServer`, `accountScopes`, `authorization: "oauth_required"`, and
`executionReadiness: "not_checked"`. If OAuth is disabled or lacks its storage
binding, authorization is `"unavailable"` and the authorization server is null. The account identifier is opaque; email,
source subject, cookies, provider keys and access tokens are not returned.
Responses are `no-store`; clients must not use cached catalog data as permission.

`accountScopes` is the account ceiling, **not an app/device grant**. Effective
access must intersect the current account permissions, the resource-specific
OAuth grant, workspace/session policy, and provider readiness. A listed resource
may lack a key or be disabled for execution. Login alone does not grant tool use.

## Native desktop boundary

The default endpoint remains browser-only. Vocs Code must not scrape cookies,
reuse a browser session token, embed a desktop client secret, or send an
OpenRouter API key to its renderer or harness subprocesses. The existing MCP
OAuth flow authorizes only its exact resource; that token must not be replayed
against this endpoint or treated as a universal Vocs account token.

Generic native MCP OAuth can be implemented independently, using the system
browser, PKCE, validated state, resource and issuer binding, an expiring loopback
callback and OS-secured token storage. This alone is not yet automatic account catalog
sync. The current Hub grants last at most five minutes from source authentication
and have no refresh tokens. Do not use them as a persistent desktop login.

## Next implementation gates

1. Define a native account client at the shared identity layer, with stable
   issuer/subject, public-client PKCE, device identity and explicit account/catalog
   scope. Keep resource grants separate from identity login.
2. Define native catalog authorization and discovery. Use an audience-bound token
   for the catalog, not a cookie or a wildcard resource grant. Verify two-account
   isolation, account switching and immediate local cache clearing on logout.
3. Add per-user connection configuration and device/app consent. New connections,
   expanded scopes and local stdio execution must never silently inherit consent.
4. Add reviewed renewal, refresh rotation/reuse detection and device/global
   revocation before enabling persistent desktop sign-in. Test interruption,
   cancellation, replay, expiry and concurrent callbacks.
5. Keep local editing and existing local tools available through a documented
   offline grace policy. Offline cloud calls fail closed. Do not force an
   untested login gate on existing installations.
6. Wire the generic Vocs Code broker first, then explicit harness adapters.
   Codex app-server is one adapter, not the owner of Vocs identity or MCP.

No production activation or migration is part of this slice. Existing default
feature flags remain unchanged. Staging remains models-only.

## Disabled native catalog verifier

`NATIVE_CATALOG_ENABLED=true` and a provisioned
`NATIVE_CATALOG_CLIENT_SECRET` enable an additional, bearer-only path. Neither is
configured by this change. A native request cannot include browser cookies or a
Cloudflare Access assertion. The same account must already have current Hub
permissions; an identity token cannot create an account or grant tools.

The agreed issuer contract is the selected identity realm plus `/api/auth`, with
JWKS at `/api/auth/jwks` and confidential introspection at
`/api/auth/oauth2/introspect`. Production and staging mappings are fixed in code.
There are no caller-controlled issuer, JWKS, introspection or resource URLs.

Accepted tokens must be ES256 `at+jwt`, issued to `vocs-code`, with exact string
audience equal to this realm's `/api/connections` URL, exact scope `catalog:read`,
nonempty `sub` and `sid`, and at most 300 seconds lifetime. Identity realm mapping
is explicit: the OAuth issuer's `/api/auth` suffix is not a new Hub account owner.
`sid` is the **source browser session**, not a per-device ID. DPoP/proof-bound
tokens are rejected until proof verification is implemented; they must not be
downgraded to bearer use.

After signature/claims verification, each request introspects the token with a
server-only confidential client. Its ID is `mcp-hub-catalog` (or
`mcp-hub-catalog-staging`). The active result must match the signed issuer,
subject, audience, client, scope, session and timestamps and report a bearer
token. No introspection allow result is cached. Redirects, missing configuration,
network failures, oversized responses and mismatches fail closed. No token or
secret is returned in catalog JSON or error messages.

This verifier is tested with ephemeral ES256 keys and synthetic introspection
responses. End-to-end compatibility with the shared identity provider remains a
release gate, including operator-disable handling, session revocation, explicit
client provisioning, cancellation, two real accounts and desktop account
switching. Do not enable it before those checks. It does not broaden existing
OpenRouter OAuth grants or turn local tools into cloud capabilities.

Native resource discovery is at
`/.well-known/oauth-protected-resource/api/connections`, distinct from the
OpenRouter resource. It is exposed only when native catalog authorization is
configured. Native 401 responses point to this metadata via `WWW-Authenticate`.
The catalog audience advertises only the pinned identity issuer and
`catalog:read`, never OpenRouter execution scopes.
