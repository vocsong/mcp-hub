import type { LoginProfile } from "./profile";
const shell = (title: string, content: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · MCP Hub</title><link rel="stylesheet" href="/login/ui.css"><script src="/login/ui.js" defer></script></head><body><main><a href="/">MCP Hub</a><h1>${title}</h1>${content}<p id="status" role="status" aria-live="polite"></p><p><a href="/">Back to the public mock preview</a></p></main></body></html>`;
export const loginHtml = (failed: boolean) =>
  shell(
    "Sign in to MCP Hub",
    `<p>Continue through Vocs Login with GitHub. Google is not available yet.</p><p>Only your stable Vocs account identifier is shared. This does not authorize MCP clients, paid requests, or backend access.</p>${failed ? "<p>The sign-in could not finish. Start again from here.</p>" : ""}<p>If Vocs Login asks you to sign in, finish there, return here, and start again.</p><button id="start">Continue with Vocs Login</button> <button id="cancel">Cancel pending sign-in</button>`,
  );
export const accountHtml = shell(
  "Your MCP Hub account",
  `<p id="account">Checking your session…</p><p>Product permissions: none. The dashboard is still a public mock, and paid capabilities remain disabled.</p><p>This product session lasts up to 30 minutes. Signing out here does not sign you out of Vocs Login.</p><button id="logout" disabled>Sign out of MCP Hub</button> <a href="/login">Sign in again</a>`,
);
export const loginCss = `:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0}main{max-width:38rem;margin:8vh auto;padding:1.5rem;line-height:1.6}h1{line-height:1.2}a{color:inherit}button{font:inherit;cursor:pointer;padding:.6rem 1rem;margin:.3rem 0}button:disabled{cursor:wait;opacity:.6}:focus-visible{outline:3px solid #698cff;outline-offset:4px}#status{min-height:1.6em}#account{overflow-wrap:anywhere}`;
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
  return loginScript.replace(
    "destination.origin!=='https://auth.vocs.io'||destination.pathname!=='/authorize'",
    `destination.origin!==${JSON.stringify(profile.issuer)}||destination.pathname!=='/authorize'||destination.searchParams.getAll('client_id').length!==1||destination.searchParams.get('client_id')!==${JSON.stringify(profile.clientId)}||destination.searchParams.getAll('redirect_uri').length!==1||destination.searchParams.get('redirect_uri')!==${JSON.stringify(profile.origin + "/login/callback")}`,
  );
}

export function loginHtmlForProfile(
  failed: boolean,
  profile: LoginProfile,
): string {
  const html = loginHtml(failed);
  if (profile.name === "production") return html;
  return html
    .replaceAll("Sign in to MCP Hub", "Sign in to MCP Hub staging")
    .replace(
      "Continue through Vocs Login with GitHub. Google is not available yet.",
      "Continue through the separate Vocs Login staging service using your existing staging account.",
    )
    .replace("Back to the public mock preview", "Back to models-only staging");
}
export function accountHtmlForProfile(profile: LoginProfile): string {
  if (profile.name === "production") return accountHtml;
  return accountHtml
    .replaceAll("Your MCP Hub account", "Your staging MCP Hub account")
    .replace(
      "Product permissions: none. The dashboard is still a public mock, and paid capabilities remain disabled.",
      "Sign-in alone grants no MCP access. Restart authorization from your client to request models:read. Paid requests, keys, audio and dashboard changes are unavailable in staging.",
    )
    .replace("Back to the public mock preview", "Back to models-only staging");
}
