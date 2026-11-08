# Secure account login: review and activation plan

This branch prepares browser account login. It does not activate login at mcp.vocs.io, share an existing VocsCode session, or issue MCP client credentials. The live public mock remains separate.

## Account boundary

Use Better Auth with Google and GitHub federation and database-backed sessions. Do not implement password storage or custom OAuth state/session cryptography. A Vocs account has a provider-neutral opaque ID; provider identity is the unique provider plus immutable subject, never a username. Email is an invitation criterion, not permission to merge two accounts. Implicit linking is disabled. Adding a second provider requires a separately reviewed authenticated linking flow.

VocsCode's documented GitHub identity and browser/MCP separation are useful architectural conventions, but its current custom web-cookie implementation is not reused. No production VocsCode files, credentials or account database are modified.

Browser cookies must be Secure, HttpOnly, host-only and SameSite=Lax. Do not share a `.vocs.io` domain cookie. Reusable accounts should eventually use a central login origin and explicit relying-party authorization, not broad cookies. The final origin must be chosen before OAuth apps are registered. Changing it later requires a planned callback/session migration.

## Threats and required evidence

| Threat | Control and qualification requirement |
|---|---|
| Login CSRF / session substitution | Vetted state and PKCE handling; browser-bound state; exact configured origins; negative missing/mismatched/replayed state tests. |
| Session fixation | Successful login issues a new unpredictable session; attacker-supplied cookie cannot become the signed-in session. |
| Email-based takeover | Verified-email invitation; no implicit account linking; same-email different-provider negative test. |
| Open redirect | Restrict login completion to owned exact origin/path; reject external callback/redirect inputs. |
| Session theft/replay | Secure host-only cookies, bounded expiry, database revocation, no localStorage credentials; stale/revoked/expired session tests. |
| Removed invitation | Admission checked for new sessions and protected requests, not only user creation; revoke sessions and fail closed. |
| Cross-account access | Obtain account ID exclusively from verified session; two-account and forged-ID tests before attaching private hub data. |
| Confused deputy | Browser cookie alone cannot authorize MCP; MCP requires its own audience/resource, scopes, consent and revocation. |
| Credential leakage | Provider secrets only in secret bindings; no token/error/body logging; identity-provider access/refresh tokens not retained for identity-only login. |
| Abuse | Durable rate limiting, bounded request bodies, no public administrative invite route; production WAF/quotas separately reviewed. |

Local mocked-provider tests validate application/library integration, not actual Google/GitHub configuration or Dots interoperability. They cannot establish a complete production security claim.

## Activation requires separate approval and setup

1. Select the exact login origin, first invited account and operational owner. Suggested long-term origin is `auth.vocs.io`, but this is a proposal, not a created service.
2. Review exact Google/GitHub OAuth app identity, callback URLs and minimum identity/email scopes. Creating apps/grants or configuring persistent credentials needs per-action approval. Never paste a client secret into chat, source, a screenshot or an issue.
3. Provision the dedicated account database and apply reviewed migrations in staging. Use independent test accounts. Do not import existing VocsCode accounts or auto-link by email.
4. Supply a high-entropy auth secret and provider client secrets using an approved secure secret workflow. Review secret rotation, backup handling, incident revocation, database retention and access controls.
5. Test the real provider redirect flows, refusal/cancellation, repeat/back navigation, verified versus unverified email, invitation removal, logout, expiry, revocation and two-user isolation in HTTPS staging.
6. Review privacy notice and consent. Identity providers and Cloudflare process login metadata; no promise of zero infrastructure metadata. Keep application logs scrubbed; implement minimal security counters with explicit retention.
7. Obtain explicit release approval after the exact deployed revision and security checks are reviewed. Keep paid provider requests and MCP client-token issuance disabled until separately qualified.

## Deliberately separate follow-on work

- MCP OAuth authorization server and protected-resource discovery, Dots/Vocs Code interoperability, scoped and audience-bound tokens, explicit client consent, revocation.
- Authenticated provider linking/unlinking, account recovery, account deletion/export and retention policy.
- Invite administration UI and safe owner bootstrap; no public self-invite endpoint.
- Production key rotation, deployment rollback, incident response and independent security review.

## References

- https://better-auth.com/docs/reference/security
- https://better-auth.com/docs/concepts/users-accounts
- https://better-auth.com/docs/concepts/session-management
- https://github.com/vocsong/VocsCode/blob/develop/docs/REMOTE-ACCESS-ROADMAP.md
- https://github.com/vocsong/VocsCode/blob/develop/docs/CONTROL-MCP.md
