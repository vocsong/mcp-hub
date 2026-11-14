# Vocs persistent desktop sessions: implementation plan

Status: design only, 14 November 2026. No desktop changes, credential provisioning, migration or production activation performed for this document.

## Verified starting point

- [VocsCode PR490](https://github.com/vocsong/VocsCode/pull/490) is merged (`cfa5978`). Its native MCP OAuth controller uses explicit public-client PKCE, memory-only access tokens, discarded refresh tokens and authorization-generation-bound transports. It is not yet a desktop account manager.
- [Vocs Login PR40](https://github.com/vocsong/vocs.io/pull/40) is merged (`06726444`), disabled by default. Its native contract issues ES256 catalog tokens lasting at most 300 seconds, no refresh token, with `sid` bound to the source browser session. An issued-token hash registry and fresh introspection support early revocation.
- [Hub contract at main8465ac3](https://github.com/vocsong/mcp-hub/blob/8465ac3ee476359bad65cc2148de7581a70764ed/docs/ACCOUNT-CONNECTIONS.md) requires exact catalog audience, `catalog:read`, pinned issuer/client and fresh introspection on every request. Catalog visibility is not permission to execute tools. These properties must survive persistence.
- Current production and staging are separate identity/resource realms. Do not migrate staging tokens or accounts into production.

## Product decision

Offer explicit **Keep this device signed in** during native authorization, default off for the first release. Browser sign-in remains in the system browser; Vocs Code never receives browser cookies, GitHub credentials, provider keys or a shared desktop client secret. Passkeys remain an issuer/browser sign-in method, not a substitute token-storage mechanism.

Choose an initial device grant with a seven-day idle limit and thirty-day absolute limit. Keep access tokens at five minutes. These are conservative proposed product defaults, not properties already implemented. Show device name, approximate last-used time, expiry and revoke action in the account page. Use a random installation ID, not hardware fingerprinting; it is an identifier, never authentication proof.

Existing local editing and existing local tools must remain available without account login. Requiring Vocs identity applies to new Vocs cloud-account features, not retrospectively locking local work or silently authorizing existing tools.

## Architecture and authority boundaries

1. **Issuer owns identity and device grants.** User account, durable device authorization, refresh family, scopes, expiry and revocation are server-authoritative.
2. **Desktop main-process account broker owns credentials.** Renderer receives only safe account status and descriptive catalog metadata. No generic read-token IPC, arbitrary URL token request or harness-owned identity store.
3. **Hub owns catalog and capability authorization.** A catalog token can read only that account's currently permitted connection metadata. Each MCP resource has its own resource-specific grant and current account-policy checks.
4. **Harnesses are adapters.** Codex, Claude and future adapters use the broker's narrow capability boundary. Do not distribute a universal account token into subprocess environment variables, settings files, command lines or logs. Prefer broker-mediated connections with explicit session/workspace policy.
5. **Provider keys stay in the Hub's separate encrypted per-user store.** Persistent desktop login does not create, read, broaden or activate provider keys, budgets or paid execution.

## Do not retrofit durability into the current browser-session token

Current `sid` means source browser session. Browser-session expiry or revocation currently invalidates native access; storing that five-minute token on disk cannot produce persistent sign-in.

Keep this v1 contract unchanged for staging integration. Add an explicitly versioned persistent-device profile with separately allowlisted client identity (proposed `vocs-code-device`) and feature flag. Do not reinterpret `sid`, extend browser sessions, bypass the active-session check or accept old tokens under new rules.

Before implementation, verify the pinned OAuth provider's supported refresh issuance, rotation, session linkage and atomic redemption behavior in real workerd/D1 tests. Select a provider-supported durable authorization/session model that clearly separates browser authentication used to approve enrollment from the device grant's lifetime. If that cannot be implemented without forging provider session semantics or bypassing validation, persistence stays off and interactive sign-in remains the fallback. Do not add a second custom token-signing stack to work around the provider.

The new profile should expose an explicit device-grant identifier (`did` or equivalent), retain a correctly defined provider `sid` if required, and document both. Hub verifies the new profile only after exact claim/introspection compatibility tests. Initial browser authorization must show account, app, requested scope and duration before enrollment. Account switch creates a separate grant; it never mutates a grant's owner.

## Server records and refresh protocol

Device grant: opaque ID, issuer realm, account ID, client ID, user-visible name, exact resource/scopes, originating authentication audit reference, created/last-used/idle/absolute expiry, state, revocation reason and policy generation. Do not retain IP/device fingerprint histories merely to label a device.

Refresh family: opaque family ID, device-grant ID, current generation, high-entropy refresh-token digest, issued/consumed/expiry/revoked timestamps. Store only a cryptographic digest server-side, never plaintext refresh tokens. Separate machine grants from browser sessions and never return registry hashes in management APIs.

- Use provider-supported rotation and reuse detection. One successful redemption consumes one refresh token and issues one replacement atomically. A public client must not rely on a static secret. OAuth security guidance requires rotation or sender-constraining for public-client refresh-token replay detection; choose rotation for this initial design. [RFC9700, refresh-token protection](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14)
- Serialize refresh in the broker with a single-flight lock per issuer/account/device. Server compare-and-swap/transaction remains authoritative across app instances and network races. Verify real D1 atomicity, not a process-local mutex.
- A consumed-token replay revokes the family and its outstanding access-token records. No reusable grace window in v1. A lost refresh response or crash before vault commit requires sign-in again rather than retrying the old token indefinitely. This sacrifices rare-case convenience for simpler replay safety.
- Check active account admission, device grant, client/resource linkage, exact scope ceiling and idle/absolute expiry on every refresh. No scope expansion through refresh; request fresh interactive consent.
- Do not auto-retry ambiguous token POSTs. Confirmed network failure before dispatch may be retried; uncertain submission or response requires explicit recovery. Rate-limit by client/grant and use generic errors without tokens or account enumeration.
- Keep access-token registry linkage to device/family so revoke invalidates already-issued access, not just future refresh. Introspection stays fail-closed and uncached.

## Desktop storage and lifecycle

Implement a narrow vault adapter with capability detection and platform integration tests. Prefer Electron's supported asynchronous safeStorage API for the installed Electron version; encrypted blobs live under app-private storage, never a repository or cloud-synced settings. Treat the blob as a secret despite encryption. Reject Linux `basic_text`/fallback-only storage and never enable plaintext fallback. On unavailable/locked vault, offer memory-only session or retry unlock. Electron notes that Windows DPAPI does not isolate secrets from malicious software running as the same user; do not claim it does. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

Namespace each record by application, environment/issuer, stable account ID and device-grant ID. Envelope contains schema version, exact pinned issuer/client/resource, refresh token and generation. Validate on load; never let envelope URLs choose a credential destination. Use OS-private permissions, atomic replace and bounded input size. Access tokens remain memory-only. A copied encrypted record is not a supported device-migration mechanism.

Broker state machine: `signed_out → authorizing → active → refreshing`; explicit `locked`, `offline`, `reauth_required`, `revoking`. Every transition has a monotonically advancing authorization generation. Late callbacks, discovery, token parsing and refresh responses may not write credentials, reopen transports or clear a newer account. Preserve PR490's generation fences and noninteractive401 behavior.

After refresh: validate response and current generation, atomically persist replacement, then expose the new access token in memory. Vault-write failure clears that session and requires recovery; never pretend persistence succeeded. Renderer requests reference opaque connection IDs, not credential destinations. Validate IPC origin/frame, payload and allowlisted operation.

## Sign-out, revocation and offline behavior

- Local sign-out immediately cancels requests, closes owned transports, increments generation, erases tokens/vault entry and account-scoped cache. It must work without network.
- Attempt remote revocation while credential is in memory, but never delay local clearing indefinitely or preserve a refresh token solely for retry. If upstream acknowledgement fails, report that local sign-out completed but remote device revocation is unconfirmed; the user can revoke from account management. Do not claim global logout.
- Account-page revoke-device and revoke-all require current same-origin account authentication and ownership checks. Sensitive device-management actions should require recent authentication. Revoke-all, account disable and membership removal invalidate linked families/access records. Removing one device must not revoke unrelated devices.
- Browser-only sign-out ends that browser session; persistent-device sign-out is separately labeled. Offer explicit “sign out all devices” rather than silently linking incompatible semantics.
- Offline local editing/tools continue indefinitely under existing local policies. Cloud operations fail closed, with no expired-token grace. Cached catalog is optional read-only display, visibly stale, never permission. Do not launch new tools or subprocesses from stale catalog. On reconnect, refresh/revalidate before re-enabling cloud actions.
- Offline status cannot prove account admission is still valid. Do not advertise a locally cached identity as a verified online session.

## Phases and acceptance gates

| Phase                  | Deliverable                                                        | Required gate                                                                                                        |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| A, current staging     | Five-minute v1 issuer → Hub catalog; no persistence                | Real signed token/introspection, two-account isolation, revoke/disable/expiry, no paid calls                         |
| B, server prototype    | Feature-disabled device-grant profile and refresh-family migration | Provider behavior proven, atomic rotation/replay tests, explicit claim/session contract, independent security review |
| C, desktop broker      | OS-vault adapter and account state machine behind flag             | Actual Windows/macOS/Linux vault tests, restart/crash/race/account-switch tests, no secret IPC/log leakage           |
| D, staging enrollment  | Opt-in device consent, management UI, broker integration           | Real system browser/passkey/social login, cancellation, token rotation, revoke-device/all, lost-response recovery    |
| E, production decision | Small opt-in rollout with rollback                                 | Separate approval, monitoring without token/content logs, tested incident revocation; never enabled by merging alone |

## Minimum adversarial test matrix

| Area            | Cases / expected invariant                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh         | Concurrent same-token requests; replay old token; expired/revoked family; response lost; commit crash. At most one rotation succeeds; uncertain state requires reauth.  |
| Isolation       | Two accounts, two devices, staging versus production, wrong client/resource/scope. No cross-account reads or token replay.                                              |
| Lifecycle       | Logout during refresh/parser/callback; switch account during vault write; app restart during rotation; duplicate app process. Old generation cannot affect new session. |
| Storage         | Locked/missing keyring, Linux fallback, corrupted blob, rollback to older encrypted file, filesystem denial. No plaintext fallback; old refresh rejected server-side.   |
| Revocation      | Device/all/account/resource/client disable, live outstanding access, issuer outage. Next server-authorized call fails; no cached allow.                                 |
| Broker boundary | Malicious renderer/frame, arbitrary URL, IPC payload injection, subprocess environment/log scrape. No credential disclosure or destination control.                     |
| Offline         | Expired token, stale catalog, clock skew, reconnect. Local work retained; cloud access requires fresh server checks.                                                    |
| Deployment      | Feature flag off, migration present without activation, rollback after issuance. Native durable endpoints deny; issued device families can be globally revoked.         |

No user decision is needed to continue staging v1. Persistent grant lifetime/consent defaults above are proposed implementation defaults; a provider limitation or request to make login mandatory for local work is a critical product/security decision, not something to silently resolve by weakening these boundaries.
