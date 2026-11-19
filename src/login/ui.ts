import type { LoginProfile } from "./profile";
// Explicit .ts specifiers: scripts/check-login-ui.mjs loads this module with Node.
import { focusPage, icon, requester } from "../ui/shell.ts";
import { rewrite } from "../ui/rewrite.ts";
/** Vocs UI focus shell. The <h1> stays attribute-free; the status region is always present. */
const shell = (
  title: string,
  who: string,
  lead: string,
  actions: string,
  before = "",
  after = "",
) =>
  focusPage({
    title: `${title} · MCP Hub`,
    head: '<script src="/login/ui.js" defer></script>',
    card: `${requester(who, "MCP Hub")}<div class="mcp-focus-title"><h1>${title}</h1>${lead}</div>${before}<div class="mcp-actions">${actions}<p id="status" class="mcp-status" role="status" aria-live="polite"></p></div>${after}`,
    foot: '<a href="/">← Back to the public mock preview</a><span>Private by invitation</span>',
  });
export const loginHtml = (failed: boolean) =>
  shell(
    "Sign in to MCP Hub",
    "Signing in to",
    '<p class="v-text">Continue through Vocs Login with GitHub. Google is not available yet.</p>',
    '<button id="start" class="v-btn v-btn-primary v-btn-lg v-btn-block">Continue with Vocs Login <span class="v-arrow" aria-hidden="true">→</span></button><button id="cancel" class="v-btn v-btn-secondary v-btn-block">Cancel pending sign-in</button>',
    failed
      ? `<div class="v-note v-note-danger">${icon.alert()}<span>The sign-in could not finish. Start again from here.</span></div>`
      : "",
    `<p class="mcp-hint">If Vocs Login asks you to sign in, finish there, return here, and start again.</p><div class="v-note">${icon.lock()}<span>Only your stable Vocs account identifier is shared. This does not authorize MCP clients, paid requests, or backend access.</span></div>`,
  );
export const accountHtml = shell(
  "Your MCP Hub account",
  "Your account on",
  '<p id="account" class="v-text mcp-account">Checking your session…</p>',
  '<button id="logout" class="v-btn v-btn-secondary v-btn-lg v-btn-block" disabled>Sign out of MCP Hub</button><a class="v-btn v-btn-ghost" href="/login">Sign in again</a>',
  `<div class="v-note">${icon.info()}<span>Product permissions: none. The dashboard is still a public mock, and paid capabilities remain disabled.</span></div>`,
  '<p class="mcp-hint">This product session lasts up to 30 minutes. Signing out here does not sign you out of Vocs Login.</p>',
);
export const loginScript = `const status=document.querySelector('#status');let busy=false;let generation=0;let starting=false;let navigation=0;
async function post(path){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin',redirect:'error'});if(!response.ok)throw Error();return response.json();}
async function action(button,run){if(busy)return;busy=true;button.disabled=true;status.textContent='Working…';try{await run();}catch{status.textContent='Could not finish. Please try again.';}finally{busy=false;button.disabled=false;}}
const start=document.querySelector('#start');const cancel=document.querySelector('#cancel');
start?.addEventListener('click',async()=>{if(starting||busy)return;starting=true;start.disabled=true;const current=++navigation;status.textContent='Opening Vocs Login…';try{const value=await post('/login/start');if(current!==navigation){await post('/login/cancel');status.textContent='Pending sign-in cancelled.';return;}const destination=new URL(value.url);if(destination.origin!=='https://auth.vocs.io'||destination.pathname!=='/authorize')throw Error();location.assign(destination.href);}catch{if(current!==navigation){try{await post('/login/cancel');status.textContent='Pending sign-in cancelled.';}catch{status.textContent='Could not confirm cancellation. Stay here and retry cancel.';}}else status.textContent='Could not start sign-in. Please try again.';}finally{starting=false;start.disabled=false;if(cancel)cancel.disabled=false;}});
cancel?.addEventListener('click',()=>{++navigation;if(starting){cancel.disabled=true;status.textContent='Cancelling sign-in…';return;}action(cancel,async()=>{await post('/login/cancel');status.textContent='Pending sign-in cancelled.';});});
const logout=document.querySelector('#logout');logout?.addEventListener('click',()=>action(logout,async()=>{++generation;await post('/login/logout');document.querySelector('#account').textContent='You are signed out of MCP Hub.';status.textContent='Vocs Login is unchanged.';logout.hidden=true;}));
async function load(){const current=++generation;if(!logout)return;logout.disabled=true;try{const response=await fetch('/login/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});if(current!==generation)return;if(!response.ok){document.querySelector('#account').textContent='Sign in to view your MCP Hub account.';return;}const value=await response.json();if(current!==generation)return;document.querySelector('#account').textContent='Signed in as Vocs account '+value.subject;logout.disabled=false;logout.hidden=false;}catch{if(current===generation)status.textContent='Could not check your session. Reload to retry.';}}
addEventListener('pagehide',()=>{++generation;++navigation;});addEventListener('pageshow',()=>{busy=false;if(start&&!starting)start.disabled=false;if(cancel&&!starting)cancel.disabled=false;load();});`;

/** Production remains byte-for-byte unchanged; staging gets its own fixed redirect guard. */
export function loginScriptForProfile(profile: LoginProfile): string {
  if (profile.name === "production") return loginScript;
  return rewrite(loginScript, [
    [
      "destination.origin!=='https://auth.vocs.io'||destination.pathname!=='/authorize'",
      `destination.origin!==${JSON.stringify(profile.issuer)}||destination.pathname!=='/authorize'||destination.searchParams.getAll('client_id').length!==1||destination.searchParams.get('client_id')!==${JSON.stringify(profile.clientId)}||destination.searchParams.getAll('redirect_uri').length!==1||destination.searchParams.get('redirect_uri')!==${JSON.stringify(profile.origin + "/login/callback")}`,
    ],
  ]);
}

export function loginHtmlForProfile(
  failed: boolean,
  profile: LoginProfile,
): string {
  const html = loginHtml(failed);
  if (profile.name === "production") return html;
  // Guarded: each staging edit must match, so production copy can never leak into staging.
  return rewrite(html, [
    ["Sign in to MCP Hub", "Sign in to MCP Hub staging", "all"],
    [
      "Continue through Vocs Login with GitHub. Google is not available yet.",
      "Continue through the separate Vocs Login staging service using your existing staging account.",
    ],
    ["Back to the public mock preview", "Back to models-only staging"],
    [
      '<div class="v-requester-what">MCP Hub</div>',
      '<div class="v-requester-what">MCP Hub staging</div>',
    ],
  ]);
}
export function accountHtmlForProfile(profile: LoginProfile): string {
  if (profile.name === "production") return accountHtml;
  return rewrite(accountHtml, [
    ["Your MCP Hub account", "Your staging MCP Hub account", "all"],
    [
      "Product permissions: none. The dashboard is still a public mock, and paid capabilities remain disabled.",
      "Sign-in alone grants no MCP access. Restart authorization from your client to request models:read. Paid requests, keys, audio and dashboard changes are unavailable in staging.",
    ],
    ["Back to the public mock preview", "Back to models-only staging"],
    [
      '<div class="v-requester-what">MCP Hub</div>',
      '<div class="v-requester-what">MCP Hub staging</div>',
    ],
  ]);
}
