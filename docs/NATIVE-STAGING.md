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
