# Shared Vocs Login for MCP Hub

This integration consumes the first-party identity handoff from
[`vocs.io` develop, `170504d`](https://github.com/vocsong/vocs.io/blob/170504d54066c0717c8ef59d52963aa204a9499c/auth/README.md).
It replaces the need to activate the duplicate Better Auth service proposed in
MCP Hub PR #1. That draft is not required or merged by this change.

## What is ready

`/login` and `/account` are optional product-account pages, served by both the
preview wrapper and private backend. The development target is disabled by default. A separately approved live-test
configuration is recorded below. The existing
public dashboard, its browser-only mock interactions, CSP, storage behavior and
MCP refusal remain unchanged. There is no public link to login until activation
is approved; the live-test entry point will be `https://mcp.vocs.io/login`.

The browser goes to Vocs Login, which offers GitHub first. Google remains a later
provider setup. The product never receives GitHub credentials or provider tokens.
If no Vocs Login session exists, sign in there, return to the product, then restart
from `/login`. Vocs Login owns its consent screen and shares only its stable account
identifier. The first-party service is **not a general OAuth/OIDC issuer** and does
not issue JWTs or MCP access/refresh tokens.

## Security and session policy

- POST initiation requires the exact product origin and an empty, bounded JSON
  body. No caller-selected return URL, issuer, client, or callback is accepted.
- The server generates independent 256-bit state, browser cookie and S256 PKCE
  verifier. State and browser binding are hashed in dedicated product D1; the
  verifier remains server-side. Pending transactions expire after five minutes.
- Callback validates the single exact `iss`, `state` and `code` parameters, then
  atomically claims its browser-bound transaction. Concurrent/replayed callbacks
  exchange at most once. Cancel, logout and a newer initiation invalidate pending
  completion, including while the external exchange is in flight. A flow association
  remains on the session so cancel/logout also wins after a callback commits but
  before its cookie response arrives.
- Only the product server posts to pinned `https://auth.vocs.io/sso/token`.
  Redirects are forbidden, time is bounded, response buffering is capped, and the
  exact issuer/audience and authentication time are checked. A JSON object sent by
  a browser is never an identity assertion. Failed exchanges are not retried.
- Identity is keyed solely by `(issuer, subject)`. No email, profile, provider
  token, IP address or user agent is imported, persisted or used for merging.
- Product sessions are random, hashed at rest, rotated after successful login,
  Secure/HttpOnly/SameSite=Lax `__Host-mcp.session` cookies with no Domain. Sessions
  have a fixed 30-minute lifetime, capped by the source session's eight-hour age.
  Reads do not extend expiry. Local principal suspension blocks existing and new
  product sessions. Logout deletes only this product session and pending login;
  it never calls Vocs Login logout or changes an existing Vocs Login session.
- There is no cross-product logout/revocation backchannel. Revoking Vocs Login can
  leave an already-established product session readable for up to 30 minutes.
  This release permits identity/account display only. **Do not enable high-impact
  capabilities before a separately reviewed revocation policy is implemented.**
- `hub_login_permission` starts empty. There is no HTTP grant endpoint, and this
  release consumes no rows from it: all returned permissions remain empty, even
  if an operator inserts a row. Browser cookies never authorize `/openrouter`,
  provider keys, audio, budgets or paid calls. Existing JWT authorization is not
  silently adapted to the Vocs identity handoff.
- Login pages/API use no-store, no-referrer, strict CSP and same-origin mutations.
  A bounded anonymous database counter admits at most 120 starts/minute globally;
  it is not per-user abuse protection. An attacker can exhaust it. Appropriate
  edge rate limits and monitoring are a deployment gate, not claimed complete.
- Never log URLs/query strings, headers, cookies, codes, PKCE values, exchange
  responses or session rows. D1 verifier material requires restricted operator
  access and retention. Expired flows are removed on new starts; scheduled cleanup
  removes expired flows and sessions. Principals persist until an approved data
  retention/erasure procedure addresses them. No permanent deletion UI is added.

## Activation parameters

These parameters were approved for the identity-only live test recorded below.
Further access expansion still requires approval. No secret is required for this
narrow PKCE client registration.

- Identity service: `https://auth.vocs.io`.
- Client ID: `mcp-hub`.
- Display name: `MCP Hub`.
- Exact callback: `https://mcp.vocs.io/login/callback`.
- Shared data: stable Vocs account identifier (`subject`), issuer, client audience
  and source authentication timestamp. No email, profile, provider token or scopes.
- Recipient/purpose: MCP Hub at `mcp.vocs.io`, to create its separate identity-only
  browser session. This grants no MCP, financial or provider capability.
- Registration target: existing Vocs Login `vocs_sso_client` table. Inspect the
  current client first; never overwrite a differing registration. Register/enable
  only after approval and preserve all existing Vocs Login sessions and providers.
- Product storage: provision a separate D1 database and bind it as `LOGIN_DB` to
  `vocs-mcp-preview`; apply `migrations/login/0001_product_sessions.sql`. Do not bind
  the Vocs Login database, the abandoned PR #1 database, or unrelated product data.
- Product activation: retain `PUBLIC_ORIGIN=https://mcp.vocs.io`, set
  `PRODUCT_LOGIN_ENABLED=true` only after approval, and deploy the preview wrapper
  with the dedicated `wrangler.preview.live.jsonc`. `APP_MODE`/`LIVE_PROVIDER` remain disabled. No route
  or DNS change is required for the existing domain, but inspect live Worker
  bindings first. Do not deploy the private `wrangler.jsonc` over the public mock.
- Set a cleanup cron, verify safe operational monitoring, backups, retention,
  database location and additional edge rate limits before wider release. The
  invited identity-only test uses the application-level 120-starts/minute cap. Raw request logs/traces
  remain disabled because callback queries carry short-lived authorization codes.
  Enable only a reviewed redacted telemetry path, never request-payload logging.

A staging origin needs its own explicitly registered client and pinned configuration,
not a wildcard redirect or reuse of production approval. This implementation pins
the production issuer/client and is tested with mocked identity exchange locally.

## Verification and remaining gates

Run `npm ci`, `npm run check`, `npm run build`, `npm run check:preview`.
`check` also runs the dependency-free UI state harness for duplicate clicks,
initiation cancellation, Back navigation, failure and stale account responses.
Cloudflare runtime tests cover pinned state/PKCE, callback duplicates/races, wrong
issuer/audience, cancellation during exchange, bounded responses, expiry, subject
isolation, session rotation, suspension, logout scope, default-deny permissions,
unchanged preview and anonymous rate limits. No paid request is part of these tests.

Before enabling live access, independently review the integration, verify actual
GitHub → Vocs Login → consent → MCP Hub flow in a real HTTPS browser, secure host
cookies, denial/cancel/back behavior, expiry/revocation expectations and mobile
layout. Mocked provider tests do not certify a real live flow or MCP interoperability.

## Approved live-test record

Activated 2026-11-08 at 17:37 UTC after explicit client/database/identity-only
activation approval. PR #2 merged as `62d4a330ac4a532bcc75ec772f512c8ba6306cfa`.

- Worker: `vocs-mcp-preview`; existing `mcp.vocs.io` custom-domain mapping preserved.
- Initial activated version: `5eafc706-ea08-43fe-a060-e5710188df62`, at 100%.
- Product D1: `vocs-mcp-login`, `e83b678d-6ae6-48e3-9eb3-a2ff8aae4094`, APAC,
  read replication disabled. `0001_product_sessions.sql` is tracked in
  `d1_migrations`. Permission records remain empty.
- Bindings: only `LOGIN_DB`, `PRODUCT_LOGIN_ENABLED=true`, and
  `PUBLIC_ORIGIN=https://mcp.vocs.io`. No provider keys, identity-provider secrets,
  R2, capability Durable Objects or MCP tokens are attached to this Worker.
- Registered exactly `mcp-hub` / `MCP Hub` /
  `https://mcp.vocs.io/login/callback`; no existing registration was replaced.
  The Vocs Login Worker and session tables were not changed.
- Cleanup cron: `*/15 * * * *`. Logs, invocation logs, traces, logpush and tail
  consumers disabled; query-string redaction configured as additional defense.
  Workers.dev and version-preview URLs remain disabled.
- Source and bundle verified against the merged source. Both exact-head GitHub CI
  runs passed; 55 runtime tests, UI state checks, typecheck, formatting, backend and
  preview dry runs, and local enabled/disabled bundle smoke passed.
- Browser automation could not launch in the restricted executor; public fetch
  inspection was unavailable. Actual GitHub → Vocs consent → MCP session remains
  a user-browser verification step, not a claimed automated success.

Test at `https://mcp.vocs.io/login`: continue to Vocs Login, approve sharing the
account identifier with MCP Hub, and confirm the product account page reports
permissions none. If Vocs Login first asks for GitHub sign-in, complete that,
return to MCP Hub, and start again. Sign out of MCP Hub and confirm Vocs Login
is still signed in. Do not test paid/provider actions.

`npm run build:preview:live` validates the dedicated live configuration without
deploying. Never deploy the disabled `wrangler.preview.jsonc` over the live test
unintentionally. Before any later deployment, inspect current bindings and retain
this product database and privacy settings.

Rollback is scoped to MCP Hub: disable its product login flag or restore the prior
preview version `bde7122f-2f1a-4f06-bb59-1ded0f003ef7`; disable the exact `mcp-hub`
registration if withdrawing product access. Do not delete either database or
alter Vocs Login sessions. Deployment rollback does not erase product D1 data.
