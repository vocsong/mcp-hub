# Vocs MCP Hub

An invite-only, multi-tenant Cloudflare MCP hub. First capability: bounded OpenRouter speech generation at `/openrouter`. The intended home is `https://mcp.vocs.io`; nothing is deployed there by this repository.

## Honest MVP status

**Runnable local preview, not a production service.** The local dashboard exercises real MCP SDK transport, SQLite Durable Objects, approval/budget controls and private R2 audio. Demo audio is a generated test tone, **not actual speech**. No paid requests were made. Production and live provider calls are disabled by default. The OpenRouter adapter is implemented and tested against mocked HTTP responses, not a live account.

Google/GitHub sign-in, reusable Vocs accounts, OAuth authorization/discovery/PKCE, remote Dots/Vocs Code compatibility, client token issuance/revocation, production monitoring and account deletion/export are release gates, not completed features. This preview uses a local-only demo identity, and includes a vetted `jose` JWT verifier for a future trusted issuer. Do not advertise it as a completed OAuth MCP server.

## Run locally

Requires Node 24+ and npm.

```sh
npm ci
npm run types
npm run check
npm run dev
```

If Wrangler cannot enumerate network interfaces in a restricted environment, use `npm run dev:portable` (same Worker through Miniflare).

Open `http://localhost:8787/dashboard`. Bind to loopback only. Do not expose the local environment through tunnels or a public host. Never put a real key into demo mode; the server refuses it.

1. Enter a short sentence and choose **Prepare request**.
2. Review the exact text, model and voice; **Approve matching text**.
3. Choose **Execute approved request**.
4. Download the private test-tone audio, then delete it.
5. Change your budget and retention and repeat. Repeated execution of the same UUID does not generate or charge twice.

For an MCP-created pending request, paste its exact text in the dashboard before approval. The server verifies a keyed fingerprint. It does not store the text or send it back to the browser. If the page reloads, resend the approved request from the original MCP client; do not generate a new request ID to retry an uncertain result.

## Protocol

Streamable HTTP POST `/openrouter` uses the official MCP TypeScript SDK, stateless JSON responses. Tools:

- `openrouter_models`: reviewed presets, currently Voxtral Mini TTS with `en_paul_neutral`.
- `openrouter_speech`: `text` (maximum 2,000 UTF-8 bytes), `voice`, `requestId` (UUID). Returns pending approval, completed authenticated audio path, or uncertain status.

Only explicitly scoped identities may invoke capabilities. MCP clients cannot approve requests, modify budgets or save keys. Audio URLs require authentication; these are not public bearer links. Some clients will need a future authenticated resource/download integration. No remote-client compatibility claim is made yet.

## Safe assumptions

- Invite-only identities, one tenant Durable Object per issuer + subject.
- $1/day local reservation budget, $0.10 per admitted call, approval on every request.
- Audio accessible for 24 hours by default, configurable 1–24 hours; immediate manual deletion.
- Text never persisted. Request fingerprints are tenant-bound HMACs and hidden from dashboard output.
- AES-256-GCM encrypted provider keys, fresh nonce and tenant/provider-bound AAD, explicit storage consent. No read-key endpoint.
- Minimal operational state: request ID, keyed fingerprint, timestamps, reservation/status, object reference. Idempotency records retained 30 days, daily counters 7 days.
- Uncertain outcomes retain the full reservation and are not automatically retried. Successful calls also retain the full reservation in this MVP; actual-cost reconciliation is a next step.
- The hub budget is an admission/reservation control, **not a guaranteed upstream spending cap**. Configure a provider-level key limit. Current documented pricing is an assumption to revalidate before enabling live calls.

## Layout

- `src/index.ts`: authenticated HTTP router and MCP SDK endpoint.
- `src/security.ts`: verified JWTs, bounded bodies, key encryption, HMACs.
- `src/tenant.ts`: durable isolated approvals, budgets, idempotency and cleanup.
- `src/provider.ts`: fixed OpenRouter speech adapter and labelled local tone.
- `src/dashboard.ts`: dashboard, no analytics scripts or third-party assets.
- `test/`: Cloudflare runtime security, transport and integration tests.
- `docs/SECURITY.md`: threat model, retention semantics and launch checklist.

## Never commit

Provider keys, encryption keys, OAuth secrets, JWTs, `.dev.vars*`, `.env*`, local `.wrangler` state, user text or generated audio. The repository may be public; application content remains private through access controls, not source secrecy.

No deployment command is provided. `npm run build` is a dry run only. Deploying, configuring production credentials, DNS or persistent access requires an explicit separate release step.
