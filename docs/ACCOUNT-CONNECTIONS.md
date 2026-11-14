# Account connections and native clients

## First implementation slice

`GET /api/connections` returns a versioned, read-only account connection snapshot.
It requires a valid same-origin Hub browser session and `dashboard:manage`.
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

This endpoint is currently browser-only. Vocs Code must not scrape cookies,
reuse a browser session token, embed a desktop client secret, or send an
OpenRouter API key to its renderer or harness subprocesses. The existing MCP
OAuth flow authorizes only its exact resource; that token must not be replayed
against this endpoint or treated as a universal Vocs account token.

Generic native MCP OAuth can be implemented independently, using the system
browser, PKCE, validated state, resource and issuer binding, an expiring loopback
callback and OS-secured token storage. This is not yet automatic account catalog
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
