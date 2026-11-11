# Security and release gates

## Disabled capability phase

[CAPABILITY-TRIAL.md](CAPABILITY-TRIAL.md) specifies the new default-disabled
product-session bridge, scoped client revocation, key lifecycle and narrower
production trial. [MCP-OAUTH.md](MCP-OAUTH.md) documents the default-disabled
standards-based OAuth layer and its remaining live verification gates. Its policy supersedes the general local-preview budget/retention
below when APP_MODE=production. The full capability backend is not deployed.
A physically separate models-only staging entry is active; see [STAGING.md](STAGING.md)
for its limited routes, identity profile, resources and verification limits.

## Trust boundaries

The outer Worker validates exact configured origin/host. With the capability bridge off, the legacy path requires a signed JWT with issuer, audience, expiry, issued-at, algorithm allowlist and invitation allowlist. With the bridge on, browser sessions require explicit account permissions and client tokens are bound to an active source session; JWT fallback is disabled. It hashes issuer + subject to route a tenant Durable Object. Caller-supplied tenant IDs are never accepted by HTTP or MCP. Worker bindings are not exposed as public RPC services.

JWT authentication uses `jose`, not home-made credentials. The future issuer must grant `models:read`, `speech:write`, `audio:read` and separate `dashboard:manage` scopes. Do not interpret possession of a provider key as a Vocs account. The local principal exists only in APP_MODE=local on a loopback origin; never deploy that environment.

Browser dashboard mutations require same-origin validation plus a custom intent header. OAuth consent uses an exact Origin plus the official library browser-bound CSRF transaction. OAuth metadata/token endpoints allow protocol-required CORS without cookie authority; protected resource and management requests reject foreign Origin. The dashboard uses external same-origin scripts and a restrictive CSP; generated data is inserted via textContent, not HTML.

Provider keys are encrypted with a 32-byte master key supplied as a Cloudflare secret, AES-GCM and per-write random nonce, authenticated to tenant/provider/version. A separately domain-derived HMAC binds request content to a tenant. Production provisioning, key rotation/version migration and a restore drill must precede live usage. Disconnection deletes the current ciphertext, but an already-dispatched request can finish. Cloud-provider backups and legal retention are distinct from logical deletion.

## Execution safety

Synchronous SQLite transaction reserves budget and moves approved requests to running before any outbound call. Duplicate UUIDs with changed arguments fail. Duplicates of running/complete/uncertain jobs never dispatch again. Approval requires matching exact text/voice/model; 15-minute expiry. Credentials, approval, scopes, budgets and content are never accepted from provider responses.

The provider adapter's only live URL is OpenRouter's fixed HTTPS speech endpoint; redirects are rejected. Only a reviewed model/voice and MP3 output are allowed. Text is bounded in UTF-8 bytes, response is bounded to 8 MiB, timeout is 25 seconds, no automatic retries or fallback. Arbitrary URLs, model IDs, provider options, uploads and reference voice cloning are not exposed.

The $0.10 reservation is not an upstream cap. Price changes and unknown outcomes may create charges beyond estimates. Before enabling live traffic: revalidate supported models/voices and prices, implement actual-cost reconciliation using X-Generation-Id and GET /api/v1/generation, verify provider-key spend limits, and test low-credit/failure behavior. PRICE_VERIFIED_UNTIL must be a reviewed timestamp no more than 24 hours ahead; it is a manual freshness gate, not automated pricing validation.

## Storage and deletion

Text exists only in request/runtime memory and the requesting browser. The hub retains no text/transcript. HMAC is not exposed through dashboard and protects against offline guessing without the master key.

R2 objects use opaque tenant/artifact keys. Metadata and scheduled cleanup are persisted before upload to cover an upload/commit crash. Expired objects cannot be downloaded immediately at the application layer. Physical deletion uses a durable alarm targeting the nearest audio expiry (with hourly maintenance), which active traffic cannot postpone. Platform failures can delay physical deletion. Configure private bucket lifecycle deletion as an independent backup before production. Do not enable r2.dev or public custom domains on the bucket.

Alarms remove idempotency records after 30 days; clients must not reuse old request IDs. Keep default bucket lifecycle to a short maximum that covers delayed/orphaned uploads. Test failure between R2 upload and SQLite final commit. No content appears in object metadata.

OpenRouter receives text and the user's key on a live call. ZDR and data_collection=deny are requested, but upstream privacy policies and legal/CSAM exceptions still apply. Never promise universal upstream zero storage. The service operator controls the Worker/master key and could technically access data; "private" means protected tenant access and data minimization, not zero-knowledge encryption.

## Observability choice

Cloudflare request logs/traces are disabled in the checked-in preview to avoid implicit IP/URL collection and accidental credential/content capture. This intentionally differs from generic Workers defaults. Before production, explicitly configure scrubbed, sampled operational counters with retention controls. Never record Authorization/Cf-Access headers, keys, text, audio, raw provider error bodies, URLs with tokens, or full request/response bodies. Dashboard local status is the only operational view today.

## Launch checklist (not done)

- Verify real GitHub → Vocs Login → product session and two-account isolation. Google remains deferred. OAuth library/discovery/PKCE/consent/scopes/revocation have local coverage, not production qualification.
- Verify CIMD/private_key_jwt clients, SDK behavior in real clients, browser login restart UX, cross-region revocation and HSTS. Review library warning output before enabling any logs.
- Dots and Vocs Code end-to-end tests against the actual supported auth and transport flows.
- Account disconnect/delete/export and encryption rotation/recovery test.
- Invite management, rate limiting across unauthenticated traffic, WAF, service-level quotas and abuse tests.
- Model pricing/voice validation, provider-key limits, actual accounting and live user-approved smoke test.
- R2 lifecycle/private-access verification and retention/crash recovery tests.
- Production auth negative tests and full JWT clock/revocation policy.
- Privacy notice and explicit provider transmission/key-storage consent in onboarding.
- External security review, controlled staging deployment, then explicit production approval.

## Sources checked 2026-11-08

- https://openrouter.ai/docs/guides/overview/multimodal/tts
- https://openrouter.ai/docs/api/api-reference/tts/create-speech
- https://openrouter.ai/mistralai/voxtral-mini-tts-2603
- https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation
- https://openrouter.ai/docs/guides/privacy/data-collection
- https://developers.cloudflare.com/durable-objects/api/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
