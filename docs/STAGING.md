# Isolated read-only staging

Status: models-only staging is deployed. Separate product D1 and OAuth KV were
created, product migrations applied there, and the exact public callback
registered in the existing staging identity service. No account permission has
yet been granted, and authenticated end-to-end verification is pending secure
user sign-in.
The existing production preview remains unchanged. This document records the
limited approved staging activation, not permission to enable paid capabilities
or enroll another account.

## Verified inventory

Read-only Cloudflare inspection found the account's workers.dev subdomain is
`vocs`. Before creation, no MCP staging Worker/product D1 or KV namespace existed.
The new resources were created only after a second collision check; no existing
resource was replaced.

The separate identity staging service already exists at
`https://vocs-login-staging.vocs.workers.dev`. Its deployed bundle and non-secret
configuration were inspected, not just an older repository copy. It implements
the same first-party `/authorize`, `/sso/authorize` and `/sso/token` contract,
including PKCE, exact enabled client/callback lookup and atomic code consumption.
Its assertion contains issuer, stable subject, client audience and source
authentication time. The issuer is the staging origin above.

This proves source/configuration compatibility, not a successful browser sign-in.
Only the exact authorized account’s identity/invitation metadata was verified.
No session tokens, password, passkey material or unrelated accounts were read. The staging
identity client table originally had no MCP registration. The separately authorized
`mcp-hub-staging` callback was then inserted without replacing any record. The production identity registration
is still only `mcp-hub` with `https://mcp.vocs.io/login/callback`.

R2 inventory returned HTTP 403, code 10042: “Please enable R2 through the Cloudflare
Dashboard.” It was not retried or enabled. A first models-only OAuth test does not
need R2, a provider key or an encryption secret. Audio and provider testing remain
separate gates; no dummy audio or successful paid-call response should mask this.

## Isolated resources

- Worker: `vocs-mcp-staging` at
  `https://vocs-mcp-staging.vocs.workers.dev`, with no production route or custom
  domain replacement.
- Product D1: `vocs-mcp-staging-login`, used only as the new Worker's `LOGIN_DB`.
  Product migrations 0001–0003 were applied here, not to either identity database
  or the existing production product database.
- OAuth KV: `vocs-mcp-staging-oauth`, bound only to the new Worker as `OAUTH_KV`.
- No Durable Object. The separate models-only staging entry avoids the private
  backend's tenant initialization entirely and does not import its provider path.
- A 15-minute cleanup cron. Request/console logs, invocation logs, traces, logpush
  and tail consumers remain off pending a scrubbed observability review.
- No `AUDIO` binding, R2 bucket, OpenRouter key, master encryption secret or pricing
  approval. Provider execution stays disabled.

`APP_MODE=production` names the application's fail-closed security mode; it does
not identify the deployment destination. The staging target must still be a
different Worker with separate storage and exact origin/profile checks. Local demo
identity must never be exposed through a public endpoint.

## Approval and identity requirements

The registered staging identity client is:

- Target: existing **staging** identity service's `vocs_sso_client` table.
- Client ID: `mcp-hub-staging`.
- Display name: `MCP Hub Staging`.
- Callback: `https://vocs-mcp-staging.vocs.workers.dev/login/callback`.
- Shared data/purpose: the authorized test account's stable staging identity,
  issuer, audience and source authentication time, to establish a separate MCP
  staging browser session. No email, profile, provider token or password is shared.
- No client secret is needed by this first-party PKCE handoff.

The approved verification/client-integration scope covers this isolated staging
setup and exact public registration. Check the existing client record first;
do not overwrite a conflicting client or broaden the production registration.
No production identity configuration or session needs to change. A second identity
is not authorized for testing; do not grant one without separate approval.

Fresh staging login still grants no capability. Each authorized test account must
be identified through a genuine staging login, then receive an explicitly approved
`models:read` grant in the new product database only. Do not assign
`dashboard:manage`, `speech:write` or `audio:read` for this phase. Do not fabricate
a real user's session, use another account, or enter passwords/tokens in chat.
Use the supported secure sign-in flow when needed.

## Remaining authenticated verification sequence

1. Recheck the recorded staging and production versions/bindings before further
   work. The resources and migrations above already exist; do not recreate them or
   reapply schema blindly. Verify the staging profile and read-only restrictions.
2. Check live HTTPS metadata, exact issuer/resource, 401 challenge, default-deny
   behavior, no cookies as MCP authority and no protected API cacheability.
3. With the one authorized existing account, verify fresh sign-in, callback state/PKCE,
   cancellation, host-only cookies, source freshness, local
   logout and consent/grants. Real two-account separation remains pending a second
   explicitly authorized account; use synthetic local tests until then. Re-entering product
   login may reuse an old source timestamp and does not prove reauthentication.
4. Grant only approved read scopes. Test actual Dots and Vocs Code discovery,
   consent, model listing, rejected speech/audio/management access and revocation.
   Use the exact callback/client behavior those applications expose; do not assume
   an SDK fixture certifies them. No persistent refresh token is issued.
5. Exercise code replay and revocation from independently verified regions before
   claiming cross-region behavior. A local KV deletion/restore regression is useful
   coverage, but requests from one runner are not a multi-region test.
6. Verify cleanup and repeat the production version/binding check. Record passed,
   failed and never-run checks separately. Mobile/browser layout and real account
   handling remain unverified until actually exercised.

If activation is blocked, the permitted alternative is the existing local
workerd/D1/KV fixture suite, which already tests the real MCP SDK and signed CIMD
client paths without real accounts. Do not substitute synthetic identity for a
claim of real end-to-end login.

## Rollback boundary

Disable only the staging access flags/endpoint and revoke the explicitly approved
staging grants when authorized. Do not change the production preview, its
registration, or identity sessions. Do not erase databases or reset trial ledgers
as an incidental rollback. Permanent resource deletion requires its own applicable
confirmation and retention review.

## Activation and live checks

Activated 2026-11-11 at 17:23 UTC using `src/staging.ts` and the separately recorded
`wrangler.staging.live.jsonc`. The ordinary `wrangler.staging.jsonc` remains off.

- Worker version: `d2e59ceb-1cb2-4151-9815-62d232d374a7`, verified at 100%.
- D1: `3459671a-c587-472c-898a-cd4990ecb8e3`, APAC primary, read replication off.
  All three product migrations are recorded. No identity database was rebound.
- KV: `77eacdfb748045dcad7f9e90e80d1da8`, dedicated to staging OAuth.
- Only D1/KV plus explicit staging flags are bound. No provider credentials, R2,
  Durable Object or custom/production domain route is present.
- workers.dev is enabled; version preview URLs are disabled. Cleanup is every
  15 minutes. Workers observability, Logpush and configured tail consumers are
  disabled, verified through API readback and Wrangler's null-as-disabled remote
  semantics. This is not an independent log-sink audit. Future logging enablement
  needs a fresh privacy review, including redaction settings.
- HTTPS checks passed for health, OAuth authorization/resource metadata, staging
  login/account pages, pinned browser redirect script and the 401 MCP challenge.
  Metadata advertises only `models:read`. HSTS is present with a one-day maximum
  age, without includeSubDomains or preload.
- Anonymous product session is 401; key/audio/speech routes and foreign-Origin MCP
  requests are 403. No application credential or paid request was used by these
  checks. Source/runtime tests total 123, including 21 staging boundary tests.
- After checks, the staging product database still contained zero principals,
  sessions, permissions and OAuth grants. The cloud browser also lacked an active
  staging/GitHub session; secure sign-in is pending. No passkey/authentication
  method was enrolled, and no second identity is authorized.
- Production was rechecked: `vocs-mcp-preview` remains at
  `5eafc706-ea08-43fe-a060-e5710188df62`, 100%, with its original identity-only
  bindings. Production identity registration and sessions were not changed.

The first public request immediately after enabling workers.dev returned a
transient routing error. A later request and all subsequent boundary checks passed.
No retry of a paid, credential or authorization exchange was involved.

Real product login, OAuth consent/model calls, actual Dots/Vocs Code connections,
two-account isolation and cross-region revocation remain distinct, unfinished
checks. Do not describe the anonymous HTTPS tests as a successful client login.
