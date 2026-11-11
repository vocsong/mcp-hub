# Verification record — 2026-11-08

## Passed locally

- TypeScript typecheck with generated Wrangler runtime types.
- 21 tests using the Cloudflare Vitest plugin, actual workerd Durable Objects/SQLite and R2 emulation.
- Dry-run production bundle, no deployment or infrastructure changes.
- Live browser UI on the local Miniflare service: prepare request; approve matching text; execute; download private WAV; delete audio; edit visible text and reject mismatched approval; restore exact text; execute; reload and retain request/budget state.
- Actual dashboard screenshots captured in browser. No simulated screenshot or image generation used.

The local demo is test-tone audio and no real API keys or paid provider requests were used. Provider HTTP contract tests use explicit mocks with unexpected network access rejected.

## Test coverage

Tenant isolation for approvals/audio, atomic concurrent budgets, concurrent duplicate dispatch, changed-content idempotency conflict, exact-content approval, approval expiry, private audio deletion, alarm deletion and non-postponement under traffic, byte limits and unknown arguments, local real-key rejection, AES-GCM tenant binding, HMAC tenant binding, origin/host/intent checks, production fail-closed config, signed JWT issuer/audience/invitation/scope, price freshness gate, fixed provider endpoint/privacy options, MCP initialize/tools list.

## Not verified / release gates

No live OpenRouter billing/audio test, remote Dots/Vocs Code auth flow, deployed Cloudflare environment, production lifecycle policy, complete OAuth onboarding, mobile visual QA, account recovery/rotation, live CI or public deployment. See SECURITY.md.

## Repository delivery

The user-created GitHub repository `vocsong/mcp-hub` is public. Initial upload was rejected because the connected GitHub app had not been granted this repository. The user updated the app installation, the repository appeared in its accessible list, and the previously denied README creation then succeeded. No alternate write route was used. Source publication uses the authorized GitHub connector; production deployment is still disabled.

## Neutral public-preview update

- Professional neutral light theme replaces the green palette in both dashboard variants.
- Separate static preview bundle has no Cloudflare bindings and cannot accept POST requests or provider keys.
- 27 tests pass, including mock-only routes, restrictive CSP and absence of browser networking/persistent storage APIs.
- Dedicated Miniflare smoke verifies the actual preview bundle starts and rejects mutations.
- Real browser verified prepare, changed-text rejection, exact approval, execute, test-tone download, delete, cancel, and full reset on reload. The public preview intentionally has no account/backend state.

## Disabled capability phase — 2026-11-11

- Final aggregate check: generated runtime types, TypeScript, 84 workerd/D1/DO/R2 tests,
  login UI fixture checks and new dashboard lifecycle fixture checks pass.
- Private backend dry-run build, unchanged public-preview runtime smoke, and
  identity-only live-config dry-run build pass. No deployment occurred.
- Independent source review found public-template coupling, delayed cleanup and
  failed-replacement admission risks. Fixed with frozen public-template isolation,
  nearest-expiry scheduling and cancellation/revision checks before reservation;
  regression checks pass. No remaining blocking finding in recheck.
- Live read-only verification confirms the existing approved identity-only version
  and bindings, zero capability grants/principals/active sessions. No live login
  success is inferred. No production database or Worker was changed.
- Mocked provider tests cover paid-path logic without provider calls. No real key,
  actual OpenRouter billing/audio, actual Dots/Vocs Code setup, real HTTPS browser
  login or final visual/mobile QA was performed in this phase.
- See CAPABILITY-TRIAL.md for release gates and residual revocation policy. Tests
  do not constitute external security qualification or approval to activate.

## Disabled standards-based OAuth phase — 2026-11-11

- Official Cloudflare OAuth provider 1.2.4 pinned; no custom OAuth token crypto.
- 102 workerd/D1/KV/DO/R2 tests pass, plus generated types/TypeScript, login UI
  fixtures and dashboard lifecycle fixtures. Backend/preview/live-config dry-run
  builds, unchanged public-preview runtime smoke and diff checks pass.
- Actual MCP SDK flow verifies RFC 9728/8414 discovery, public registration,
  SDK-generated S256 PKCE, browser consent, callback state/issuer validation, code
  exchange, initialization, tool listing, model read, insufficient-scope challenge
  and browser revocation. No refresh token or dashboard authority is issued.
- A separate ephemeral-key fixture verifies CIMD/JWKS + ES256 private_key_jwt code
  exchange and authenticated RFC 7009 revocation, including invalid signatures,
  wrong-client non-disclosure, a missing KV record and restored stale KV data.
  Only local fixture URLs are accepted. No provider or identity network call runs.
- Independent review identified and fixed foreign-Origin/mixed-credential routing,
  PKCE syntax validation and an eventually-consistent KV revocation gap. Token
  hashes must now be registered on the D1 primary before issuance responses and
  resource access. The independent recheck found no remaining high-confidence
  blocker in those fixes. This is not external security qualification.
- Read-only HTTPS/browser checks of the existing live login found identity-only
  GitHub login and an anonymous product session. No real authenticated session or
  two-account test credentials were available. Successful live account isolation,
  actual Dots/Vocs Code login, mobile QA and cross-region revocation remain open.
- All capability/OAuth/provider flags remain disabled in checked-in configuration.
  No live migration, KV provisioning, credential entry, paid request or deployment
  occurred. See MCP-OAUTH.md for exact release gates, residual upstream revocation
  and operational logging limitations.
