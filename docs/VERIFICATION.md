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
