# Native catalog staging integration

This rollout is **staging only**. It does not enable provider execution, durable desktop sessions, production identity, or production MCP access.

## Fixed contract

- Issuer: `https://vocs-login-staging.vocs.workers.dev/api/auth`
- Public native client: `vocs-code`, PKCE S256, explicit consent, no client secret.
- Catalog: `https://vocs-mcp-staging.vocs.workers.dev/api/connections`
- Scope: exactly `catalog:read`; ES256 `at+jwt`, at most 300 seconds.
- Confidential verifier: `mcp-hub-catalog-staging`, only this catalog resource. Secret lives in the Hub Worker secret binding; issuer stores its SHA-256 hash. Never place it in desktop settings, scripts, repository files or chat.
- Hub access still requires current Hub principal/permission rows. Identity login cannot silently create tool permissions. Staging exposes models-only; keys, speech/audio and paid execution remain disabled.

## Deployment sequence and rollback

1. Apply additive issuer migration0006 to the existing staging-only identity D1, not production.
2. Provision the catalog resource and public client, then confidential client/resource link and matching Hub secret. Never overwrite an existing client/secret without an explicit rotation plan.
3. Test actual issuer token issuance against the actual Hub verifier, including two synthetic accounts and fresh revocation. Local fixtures are not live-user validation.
4. Deploy the tested merged issuer bundle to `vocs-login-staging`, preserving its existing secret bindings. Enable only its staging native feature flag.
5. Deploy tested Hub `src/staging.ts` to `vocs-mcp-staging`, preserving its dedicated D1/KV and secret. Set `NATIVE_CATALOG_ENABLED=true` only there. The ordinary staging template and production configs remain disabled.
6. Verify anonymous boundaries using `npm run check:native:staging`; the script has pinned staging URLs, no credential input, no paid or authenticated calls, and fails on redirects/unexpected cache policies. On proxy-managed Node installations use their supported environment-proxy startup option.
7. Recheck both production Worker deployments unchanged. Record authenticated and desktop checks separately; do not equate public metadata success with successful sign-in.

Rollback means disabling **only staging** native flags and retaining data/keys for investigation. Do not delete databases, reset trial ledgers, revoke unrelated browser sessions or change production. Existing resource OAuth and browser product login remain distinct.

## Remaining real-client gates

- System browser authorization and loopback callback using the real desktop client.
- Explicit consent, denied/canceled sign-in, repeat sign-in, source-session logout and issuer disable.
- Two authorized real accounts, switching, current Hub permissions and local catalog clearing.
- No paid calls or provider credentials for this phase.
- Persistent authorization is a separate design: see [PERSISTENT-SESSIONS.md](PERSISTENT-SESSIONS.md). The five-minute browser-session-bound token is intentionally not durable login.

## Staging deployment record, 14 November 2026

- Hub Worker version `f1743332-e3bc-4dc2-aaa6-283ffc8c66ff` deployed at 100%, from tested merged `8465ac3` runtime. Native catalog flag and secret binding read back successfully; dedicated staging D1/KV retained. Bundle SHA-256 `25657ab7b9a5caad7d46f1ca54c41d33b17e3461246ab73dec0573119817f66b`.
- Production Hub preview remains version `5eafc706-ea08-43fe-a060-e5710188df62`, unchanged with identity-only bindings.
- Hub verification:144 workerd tests, full typecheck, login/dashboard fixtures and staging dry-run pass. Public smoke validation is tracked separately from deployment/API readback.
- Issuer actual-worker/Hub actual-verifier local test covers two synthetic accounts plus token revoke and admission disable. No synthetic accounts were inserted into live databases. No browser/desktop or live authenticated success is claimed by this record.
- Public pinned smoke **passed** after transient runner connection timeouts: health200/models-only, exact catalog metadata200, anonymous/malformed bearer401, foreign Origin403, keys/audio/speech403, no-store and HSTS throughout. No configuration workaround or credentialed call was used. This is anonymous boundary verification, not successful real-user/desktop authorization.
