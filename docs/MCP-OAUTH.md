# MCP OAuth trial and isolated staging

## Scope and evidence

This is the next source phase of the approved MCP Hub work. The private backend
uses `@cloudflare/workers-oauth-provider` **1.2.4**, pinned in the lockfile, for its
authorization server and protected resource. It does not implement its own OAuth
token cryptography. The actual MCP TypeScript SDK exercises discovery through
authenticated tool calls in the local Cloudflare runtime.

That is protocol integration evidence, **not a successful connection from actual
Dots or Vocs Code**. The full capability backend remains disabled. A subsequent
[isolated models-only staging phase](STAGING.md) created separate D1/KV and deployed
a restricted entry, with live anonymous HTTPS checks passing. Authenticated
verification is pending secure user sign-in. No provider key or paid request was
used. The production identity-only preview remains unchanged.

## Protocol contract

- Issuer: the exact canonical HTTPS `PUBLIC_ORIGIN`.
- Resource: `PUBLIC_ORIGIN + /openrouter`; explicit resource indicators must match this sole resource at authorization and
  code exchange. When omitted, the library resolves authorization to the default
  resource and exchange to the grant’s bound resource. Tokens do not authorize the dashboard.
- RFC 9728 metadata: `/.well-known/oauth-protected-resource/openrouter`.
- RFC 8414 metadata: `/.well-known/oauth-authorization-server`.
- Authorization: `/oauth/authorize`; explicit browser consent is required for
  each grant. Selected scopes may only reduce the original requested set and must
  still be permitted to the authenticated account.
- Token and RFC 7009 revocation endpoint: `/oauth/token`, as advertised by the
  official library. A revocation form sends `token` without `grant_type`.
- Authorization code only, S256 PKCE for every client. Challenge and verifier
  syntax are validated. No implicit grant, refresh token or token exchange grant.
- Baseline scope is `models:read`. Speech additionally requires `speech:write`;
  authenticated audio requires `audio:read`. Insufficient scope returns a 403
  `WWW-Authenticate` challenge with the needed scopes and resource metadata.
- Audio is below the same resource at `/openrouter/audio/{id}`. It is not a public
  URL and has no query-string token. The browser dashboard can still use its own
  same-origin `/audio/{id}` route with product-session authority.

The MCP SDK client fixture validates callback state and issuer before handing the
code to the SDK. The embedding real client must do the same. The SDK does not
automatically validate the browser callback from a code string alone.

## Client registration and browser identity

CIMD (HTTPS Client ID Metadata Documents) is enabled in the OAuth library, matching
the current MCP specification's preferred client-discovery mechanism. The private
Worker includes `global_fetch_strictly_public` so metadata resolution cannot reach
private network addresses. Client name/URL metadata is untrusted and escaped.
A controlled fixture exercises CIMD/JWKS resolution and signed ES256
`private_key_jwt` exchange/revocation using ephemeral keys and strict local fetch
fixtures. Real client metadata, network behavior and interoperability remain
release gates.

Optional dynamic registration is separately gated by `OAUTH_DCR_ENABLED=true` for
older clients. It admits only public authorization-code clients with no client
secret, software statement or JWKS. A D1-primary counter limits registration to
10 per minute and 1,000 per day globally; registration uses a renewable 24-hour TTL. Successful token/revocation requests
renew it after half its lifetime, so this is not an absolute registration lifetime.
These controls are not a substitute for edge abuse protection, and a malicious
caller can exhaust the shared allowance. DCR is not advertised when disabled.

Production and staging use finite, exact origin/issuer/client profiles. Staging
sessions cannot authorize production, or vice versa, even if storage is mistakenly
shared in a local test. The deployed databases are also physically separate.

Vocs Login remains a separate first-party identity handoff, not an OIDC or MCP
OAuth issuer. OAuth grants require an active product session and explicit operator
capability permissions. Knowing a key or signing into the browser grants no
capability by itself. The consent page binds the displayed client, exact requested
resource/scopes, product session and browser transaction. Switching accounts
between displaying and approving consent is rejected.

An anonymous authorization request shows a safe link to `/login`. After login the
user must restart the connection from the MCP client. The implementation does not
add an arbitrary `returnTo` parameter or silently resume a stale consent. This
restart UX needs verification in the actual clients before activation.

## Primary-consistent authorization and revocation

The official OAuth library stores protocol state in Cloudflare KV, which is
eventually consistent. The application adds D1-primary checks rather than claiming
KV provides globally atomic single-use grants or immediate revocation:

- A bounded, hashed consent handle is bound to the exact product session and
  consumed once. At most 20 outstanding consent transactions per session are
  admitted before the library writes a browser transaction.
- An internal grant identifier is stored in encrypted library properties. The
  library user ID is a digest of issuer plus stable subject, not an email/profile.
- Code exchange atomically marks the D1 grant exchanged once after the library
  validates the code and PKCE. Failed or uncertain exchanges require restarting;
  they do not receive an automatic retry that could mint another token.
- A hash of each issued access token is registered against the D1 grant and client
  before returning it. Resource validation requires that registry plus the
  library token validation. Unregistered tokens cannot be used after a partial
  issuance failure.
- Explicit revocation resolves the token hash on the primary, so a regional KV
  miss cannot turn successful revocation into a temporary no-op. Client ownership
  and authentication are checked before a D1 tombstone is written. Browser grant
  revocation is owner-bound and does not depend on KV propagation.
- Every request rechecks the local product session, principal suspension, current
  operator scopes, resource, client, grant status and source-authentication age.
  Logout deletes the source session and cascades its grants. Local permission
  removal and revocation block later requests even while KV still has a token.

Access expires at most five minutes after **source authentication**, not five
minutes after each token exchange. Issuance requires at least 60 seconds remaining
because KV TTL has a platform minimum. Product browser reads can last 30 minutes.
There is no upstream Vocs Login logout/revocation backchannel. A source logout may
therefore remain usable locally for the remainder of that five-minute client
window; re-entering product login does not necessarily refresh source authentication.
Already dispatched work may finish. These are explicit residual risks, not a
claim of immediate global logout or persistent client access.

## Data, cleanup and origin rules

No plaintext access token or code is stored in D1. Token/code wrapping and encrypted
OAuth properties are library-managed in KV. D1 retains minimal consent/grant/token
hash metadata, client identifier, scopes and timestamps. It stores no provider
key, text or audio. OAuth tokens never become provider credentials.

The library applies TTLs to browser transactions, unexchanged codes, access tokens,
grants and optional registrations. D1 consent/grant cleanup runs in bounded batches
from the private backend's scheduled handler; grant deletion cascades token hashes.
An approved deployment must provision and verify its cron, retention/backups and
access restrictions. TTL expiry and application denial are not an assertion about
cloud backup erasure.

Browser management uses the product session and exact origin. Consent additionally
uses the library's browser-bound CSRF handle. Bearer access cannot authorize
management, and mixed bearer/session/Access credentials are rejected. Foreign
Origin is rejected on the protected resource. OAuth metadata, registration and
token endpoints use the library's protocol CORS without granting cookie authority.

Default logs/traces remain disabled. Sanitized OAuth errors contain no token or
provider body. The dependency also has direct warning paths containing client
metadata URLs or grant identifiers outside its `onError` hook. Enabling tail logs,
console collection or tracing requires reviewing/suppressing those paths first.
Do not promise that enabling generic logs is safe because application errors are
sanitized. Credentials, content, callback queries and full payloads must not be
logged.

## Configuration and release gates

The implementation requires all of: `APP_MODE=production`,
`PRODUCT_LOGIN_ENABLED=true`, `CAPABILITY_AUTH_ENABLED=true`, `OAUTH_ENABLED=true`,
canonical HTTPS origin, a separate product `LOGIN_DB` with migrations 0001–0003,
and a dedicated `OAUTH_KV` binding. Default configurations keep capability/OAuth
flags false. Only the dedicated `wrangler.staging.live.jsonc` activates the
models-only staging entry with isolated D1/KV; it cannot execute paid capabilities.
Do not deploy the private backend over the existing identity-only mock.

Before broader capability activation, beyond the deployed models-only staging:

1. Complete a genuine GitHub → Vocs Login → MCP Hub login in a controlled HTTPS
   browser with two authorized accounts. Verify isolation, cancellation, account
   switching, logout, cookie flags and mobile layout. Live read-only checks on
   2026-11-11 found an anonymous cloud browser, not a logged-in user. No credentials
   or authorized two-account test fixtures were available, so this gate is open.
2. Review the five-minute residual upstream revocation window, short-grant UX,
   login restart behavior and missing HSTS observed on `mcp.vocs.io` responses.
   The identity service did return HSTS. Production headers remain unchanged;
   the isolated staging entry now sets HSTS.
3. Review exact grants, new D1 migration/KV binding, cron, metadata fetching, client
   registration limits, private storage, encryption secret provisioning and logs.
4. Verify actual Dots and Vocs Code discovery/consent, requested scopes, CIMD or
   public DCR behavior, audio download and local logout/revocation. The local signed
   client fixture does not certify those clients. Exercise revocation across actual
   Cloudflare regions; local KV-miss simulation is not a global propagation test.
5. Keep provider execution disabled until the separate provider price/key-limit
   review and specific paid trial approval in CAPABILITY-TRIAL.md. OAuth consent
   authorizes scoped access, not automatic purchase or speech approval.

## Sources reviewed 2026-11-11

- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md
- https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md
- https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/mcp-discovery.md
- https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/advanced-configuration.md
- https://github.com/cloudflare/workers-oauth-provider/issues/214
