/** OAuth browser pages in the Vocs UI focus shell. Every client-supplied string is
 * escaped here; the consent form posts handle/scope/decision exactly as before. */
import { focusPage, icon, requester } from "./ui/shell";

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const esc = escapeHtml;

/** Plain-language meaning of each scope the Hub can grant. */
const SCOPE_MEANING: Record<string, string> = {
  "models:read": "Read models",
  "speech:write": "Request speech",
  "audio:read": "Read private audio",
};

export const signInRequiredHtml = () =>
  focusPage({
    title: "Sign in · MCP Hub",
    card: `${requester("Authorization paused", "MCP Hub")}<div class="mcp-focus-title"><h1>Sign in to continue</h1><p class="v-text">Sign in, then restart authorization from your client.</p></div><div class="mcp-actions"><a class="v-btn v-btn-primary v-btn-lg v-btn-block" href="/login">Sign in <span class="v-arrow" aria-hidden="true">→</span></a></div><div class="v-note">${icon.lock()}<span>No access has been granted. Your MCP client has to start authorization again after you sign in.</span></div>`,
    foot: "<span>MCP Hub · OAuth</span><span>Private by invitation</span>",
  });

export interface ConsentPage {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectUri: string;
  redirectIsLoopback: boolean;
  resource: string;
  handle: string;
  scopes: string[];
  staging: boolean;
}

export const consentHtml = (c: ConsentPage) => {
  const client = c.clientDomain
    ? `<span class="v-badge v-badge-live">Verified</span><span>Verified client domain: <span class="v-mono">${esc(c.clientDomain)}</span></span>`
    : '<span class="v-badge v-badge-warn">Unverified</span><span>Client name is self-asserted and unverified.</span>';
  const scopes = c.scopes
    .map(
      (s) =>
        `<label class="v-check"><input type="checkbox" name="scope" value="${esc(s)}" checked><span class="mcp-scope"><span class="v-mono">${esc(s)}</span>${SCOPE_MEANING[s] ? `<span class="mcp-scope-desc">${SCOPE_MEANING[s]}</span>` : ""}</span></label>`,
    )
    .join("");
  return focusPage({
    title: "Authorize Vocs MCP",
    plainBrand: true,
    wide: true,
    card: `${requester("Authorization request", c.staging ? "MCP Hub staging · models only" : "MCP Hub · OpenRouter")}<div class="mcp-focus-title"><h1>Authorize ${esc(c.clientName)}</h1><p class="v-text">Check who is asking and where access goes before you decide.</p></div><dl class="mcp-facts"><div><dt>Client</dt><dd>${client}</dd></div><div><dt>Redirect</dt><dd><span>Redirect destination: <span class="v-mono">${esc(c.redirectHost)}</span></span><span class="v-mono mcp-uri">${esc(c.redirectUri)}</span></dd></div><div><dt>Resource</dt><dd><span class="v-mono">${esc(c.resource)}</span></dd></div></dl>${c.redirectIsLoopback ? `<div class="v-note v-note-danger">${icon.alert()}<span>Any local process could be listening at this loopback address.</span></div>` : ""}<form class="mcp-consent" method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${esc(c.handle)}"><fieldset class="mcp-scopes"><legend class="v-label">Scopes</legend>${scopes}</fieldset><div class="v-note">${icon.clock()}<span>Access ends within five minutes of source sign-in. No dashboard access or refresh token. ${c.staging ? "This staging service lists models only. It cannot execute speech, paid requests or audio operations." : "Speech still requires your separate exact-text approval; this consent does not execute a provider request."}</span></div><div class="mcp-decide"><button class="v-btn v-btn-primary v-btn-lg" name="decision" value="approve">Approve selected scopes</button><button class="v-btn v-btn-secondary v-btn-lg" name="decision" value="deny">Deny</button></div></form>`,
    foot: "<span>Signed in with Vocs Login</span><span>Private by invitation</span>",
  });
};
