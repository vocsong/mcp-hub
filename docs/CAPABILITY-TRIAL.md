# Scoped OpenRouter capability trial (disabled)

## Status and boundaries

This phase is source and local-test work only. No deployment, capability grant,
new live credential, paid request or Dots/Vocs Code connection was performed.
A later isolated models-only staging activation is recorded in [STAGING.md](STAGING.md);
it does not activate this full capability backend or paid provider path.
The existing production identity-only preview and its bindings remain unchanged. The public
mock uses a frozen template, not the private capability dashboard.

Read-only Cloudflare verification on 2026-11-11 found the approved preview version
`5eafc706-ea08-43fe-a060-e5710188df62` still at 100%, with only LOGIN_DB,
PRODUCT_LOGIN_ENABLED and PUBLIC_ORIGIN. The product database had zero principals,
active sessions and capability permissions. Therefore a real successful product
login is still an unverified release gate.

## Explicit authorization bridge

Only the private backend `src/index.ts` can opt into this phase. It requires
APP_MODE=production, PRODUCT_LOGIN_ENABLED=true, CAPABILITY_AUTH_ENABLED=true,
a canonical HTTPS PUBLIC_ORIGIN and separate product LOGIN_DB. All checked-in
capability configuration remains disabled. Merely setting a login cookie,
creating an account, knowing a provider key or changing a caller's subject is
never a capability grant.

An operator must explicitly grant the intended `(issuer, subject)` rows in
hub_login_permission. There is no HTTP grant API. `dashboard:manage` admits the
private dashboard and its account management. `speech:write` is additionally
required to prepare/approve speech. The browser cannot use its cookie as MCP
authorization. Enabling the bridge disables legacy JWT fallback for this backend.

Every request checks the active product session, principal and current grants on
the D1 primary. Tenant routing hashes the issuer and stable subject, never email
or client-provided tenant identifiers. Same-origin browser mutations require an
exact Origin, JSON and the dashboard intent header. Browser capability mutations
require source authentication within five minutes. Read-only access, revocation, key disconnection, audio deletion
and logout remain available for the product session's ordinary lifetime.

Local logout, local principal suspension, local grant removal and explicit token
revocation block subsequent authenticated requests. An already admitted/dispatched
request can finish. There is no upstream Vocs Login revocation backchannel. Access after
source revocation may remain valid locally for up to five minutes for mutations and
client calls, and 30 minutes for browser reads. Re-entering the product login does
not necessarily refresh the upstream authentication timestamp. A genuinely fresh
upstream sign-in is needed when this gate expires. This residual policy needs
review before any capability deployment; it is not a claim of immediate global
logout or production qualification.

## Connect, replace and disconnect OpenRouter

The production dashboard accepts the user's own OpenRouter key only with explicit
storage and provider-transmission consent. AES-256-GCM uses a fresh nonce and
version/provider/tenant-bound AAD. Only ciphertext and the consent timestamp/version
are retained; no read-key endpoint exists. The encryption secret must be provisioned
through an approved secure secret flow, never chat, source control or a public form.
The operator can decrypt keys, so this is not zero-knowledge storage.

Key replacement and disconnect invalidate pending/approved jobs. A generation
counter prevents an in-flight encryption from restoring a disconnected key and
rechecks key changes before provider dispatch. Failed replacement retains the old
key but cancels old approvals without spending the reservation. Disconnect is
logical deletion from current application storage; provider/cloud backups and
legal retention are separate. Work already dispatched may finish. Stored keys,
request text, client tokens and audio must never be logged.

The provider receives the key and exact approved text only at execution. Privacy
options request ZDR and data_collection=deny; upstream exceptions still apply.
The UI clears entered keys after submission/failure and on navigation. It has no
analytics, third-party scripts, persistent browser storage or automatic clipboard.

## One-request TTS trial

Production clamps policy to one admitted request per tenant in total, using a
persistent $0.10 reservation, not a daily-reset allowance. There is no UI/API reset.
The policy can lower the budget to zero, but cannot turn off approval, raise the
ceiling or extend audio access past one hour. Text is at most 300 UTF-8 bytes. Only
the existing reviewed model, voice and MP3 response are accepted.

The provider stays disabled. Disabled production speech is an error, never a
successful demo tone. The manual price-freshness gate is checked before reservation.
Actual supported model/voice, pricing and provider key limits must be revalidated
before activation. This PR does not perform that price review.

The reservation is **not a guaranteed OpenRouter billing cap**. Set an enforceable
provider-side key limit and confirm the exact trial text, provider, model, total
limit and charge before a live request. Unknown outcomes retain the entire
reservation and are never automatically retried. Success also retains it. A fresh
UUID, key replacement, disconnect/reconnect, new client token or next day cannot
reset the lifetime reservation. Actual-cost reconciliation remains a release gate.

Text is not persisted. Exact-content approval uses a tenant-bound HMAC. Audio uses
opaque private R2 keys and authenticated downloads. Application access ends at one
hour; the Durable Object alarm targets the nearest artifact expiry for deletion.
Physical cleanup can still be delayed by platform failures. Private bucket access,
lifecycle backup deletion, backup retention and recovery tests remain deployment
gates. Manual deletion retains an idempotency tombstone, not a way to rerun a job.

## Standards-based MCP OAuth trial

The private backend now implements an additional default-disabled OAuth flow using
the official Cloudflare authorization-server/resource-server library. Discovery,
S256 PKCE, browser consent, scoped authorization-code grants, five-minute access
tokens and primary-D1-backed revocation are exercised with the actual MCP SDK.
See [MCP-OAUTH.md](MCP-OAUTH.md) for the detailed contract and remaining gates.
OAuth-mode clients receive no dashboard management permission or refresh token.

## Optional manual MCP client trial

GET/POST /api/clients and DELETE /api/clients/{id} manage browser-owned grants.
Explicit consent selects only `dots` or `vocs-code` and a subset of current
`models:read`, `speech:write`, `audio:read` permissions. There is no dashboard scope.
The client labels express intended use, not cryptographic proof of which app is
presenting the bearer token. Treat a token as a secret.

Tokens are random 256-bit opaque credentials, hashed at rest, bound to the exact
resource origin `/openrouter`, owner and issuing product session. They expire at
most five minutes after source authentication and cannot outlive the session.
Issuance uses one guarded SQL statement; logout also cascades token invalidation.
At most 20 active tokens per account are allowed. Scheduled cleanup removes expired
or revoked tokens. List responses contain metadata only. The one-time displayed
value is cleared on hide/navigation/expiry/revocation and stale responses cannot
restore it. No refresh tokens or persistent agent authority are issued.

Clients use Streamable HTTP POST `/openrouter` with the token in the Authorization
Bearer header. Cookies, URL tokens, malformed/mixed credentials, foreign origins,
wrong resources and management attempts are rejected. Audio also requires the
audio scope. MCP clients cannot save keys, change policy or approve speech.

This manual path is **not OAuth or verified Dots/Vocs Code interoperability**.
When OAUTH_ENABLED=true, the dashboard shows standard OAuth connection/grant
management instead; new manual issuance is blocked and the OAuth resource does
not accept these manual credentials. GET/DELETE client APIs remain available to
inspect/revoke pre-existing five-minute manual grants.
No actual client configuration was installed. A client using the manual path must
support secure manual bearer configuration.
Do not paste tokens into chat, repository config, command history or URLs. The
local router tests exercise real MCP initialize/tools/list/call with scoped
credentials, but cannot certify either external client's supported flow.

## Release sequence, not authorization to deploy

1. Verify real GitHub → Vocs consent → product session and two-account isolation,
   sign-out, cancellation, back navigation and mobile layout.
2. Review residual source-revocation behavior and separately approve staging
   deployment, exact grants, product DB migrations 0002/0003, dedicated OAuth KV, encryption secret,
   private R2/lifecycle, capability DO binding and scrubbed operational controls.
   Do not deploy the private Worker over the identity-only mock.
3. Run the approved secure BYO-key connection, then a specifically confirmed tiny
   live TTS request with a provider-side spend limit. No key should pass through chat.
4. Test discovery, login/consent, read-only OAuth access and scope escalation in
   actual Dots and Vocs Code, then separately approved speech, authenticated audio,
   logout and local revocation. Verify CIMD/private_key_jwt where required. Record
   unsupported flows honestly; an SDK fixture alone does not certify these clients.
5. Production deployment, broader budgets, persistent credentials, billing
   reconciliation, key rotation/recovery, account export/deletion and external
   security qualification remain separate decisions.

Rollback: keep the existing preview untouched; disable CAPABILITY_AUTH_ENABLED
and LIVE_PROVIDER on an independently approved capability deployment. Revoke local
grants/tokens as approved. Do not erase databases, reset trial reservations or
change Vocs Login sessions as a deployment side effect.
