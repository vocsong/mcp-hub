// Shell partials use an explicit .ts extension: scripts/check-dashboard-ui.mjs loads
// this module directly with Node, which resolves only exact specifiers.
import {
  brandLink,
  headTags,
  icon,
  SHELL_SCRIPT,
  switcher,
} from "./ui/shell.ts";

/** Private dashboard: Vocs UI app shell. Element ids, form names and row structure
 * are the contract with `script` below and scripts/check-dashboard-ui.mjs. */
export const dashboard = `<!doctype html>
<html lang="en" data-product="mcp">
<head>${headTags("Vocs MCP Hub")}<script src="${SHELL_SCRIPT}" defer></script><script src="/app.js" defer></script></head>
<body class="v-root">
<a class="v-skip" href="#main">Skip to content</a>
<header class="v-topbar"><div class="v-wrap v-wrap-wide v-topbar-inner">${brandLink}<div class="v-topbar-actions">${switcher}<a class="v-avatar" href="/account" aria-label="Account">V</a></div></div></header>
<div class="v-app-layout">
<nav class="v-sidenav" aria-label="MCP Hub">
<span class="v-sidenav-group">Hub</span>
<a href="#main" aria-current="page">${icon.grid()}Overview</a>
<a href="#connect">${icon.link()}Connection</a>
<a href="#control">${icon.sliders()}Limits</a>
<a href="#try">${icon.wave()}Speech</a>
<a href="#review">${icon.list()}Requests</a>
<a class="mcp-nav-access" href="#access">${icon.shield()}Client access</a>
<div class="v-sidenav-foot"><div class="v-me"><span class="v-avatar" aria-hidden="true">V</span><div><div class="v-me-name">Vocs account</div><div class="v-me-role">Invite-only preview</div></div></div></div>
</nav>
<main class="v-app-main mcp-anchor" id="main">
<div class="v-page-head mcp-page-head"><div><p class="v-eyebrow v-eyebrow-sm">Your keys. Your control.</p><h1 class="v-display-m">One home for your AI capabilities.</h1><p class="v-text">OpenRouter is the first connection. Private by design, with spending controls and temporary audio.</p></div></div>
<div class="mcp-stack">
<div class="v-note mcp-notice">${icon.info()}<div id="notice" role="status">Loading your account…</div></div>
<div class="v-grid-2">
<article class="v-card mcp-card" id="connect">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">01</span>Connect</p></div>
<div class="mcp-card-title"><span class="v-glyph v-glyph-lg mcp-logo" aria-hidden="true">OR</span><h2 class="v-title">OpenRouter</h2></div>
<p class="mcp-endpoint"><span>Endpoint <strong>/openrouter</strong></span><span>models · speech</span></p>
<p id="connection" class="mcp-conn"></p>
<form id="keys" class="mcp-form"><label class="v-field"><span class="v-label">Provider API key</span><input class="v-input" id="key" type="password" autocomplete="off" placeholder="Never paste a key into chat"></label><label class="v-check"><input id="consent" type="checkbox">I authorize MCP Hub to encrypt and store this key and transmit my text and provider key to OpenRouter only for requests I approve.</label><div class="mcp-form-actions"><button id="save-key" class="v-btn v-btn-primary">Save key</button><button type="button" id="disconnect" class="v-btn v-btn-danger">Disconnect</button></div></form>
<p class="mcp-fine">MCP Hub’s operator can decrypt this key: this is not zero-knowledge storage. Disconnect logically deletes the key; backup copies may remain until backup expiry. It cancels pending approvals, but work already dispatched may finish. Demo mode cannot save keys. Set a provider-side spending limit too.</p>
</article>
<article class="v-card mcp-card" id="control">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">02</span>Control</p></div>
<h2 class="v-title">Your limits</h2>
<form id="policy" class="mcp-form"><label class="v-field"><span class="v-label">Reservation budget (USD)</span><input class="v-input" id="budget" type="number" min="0" max="10" step="0.01" required></label><label class="v-field"><span class="v-label">Audio retention (hours)</span><input class="v-input" id="retention" type="number" min="1" max="24" required></label><label class="mcp-toggle"><span>Approve every request</span><input id="approval" type="checkbox"></label><div class="mcp-form-actions"><button class="v-btn v-btn-primary">Save controls</button></div></form>
<p class="mcp-fine">Each request reserves $0.10. This is a local admission limit, not a guaranteed provider billing cap. Configure a provider-key limit too.</p>
</article>
</div>
<div class="v-grid-2">
<article class="v-card mcp-card" id="try">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">03</span>Try it</p></div>
<h2 class="v-title">Text to speech</h2>
<form id="speech" class="mcp-form"><label class="v-field"><span class="v-label">Text</span><textarea class="v-input" id="text" maxlength="2000" required placeholder="Write a short sentence…"></textarea></label><div class="mcp-form-actions"><button id="prepare" class="v-btn v-btn-primary">Prepare request</button></div></form>
<p class="mcp-fine">The local demo returns a test tone, not speech. Text is not stored. Review the text above, then approve below. For an MCP request, paste its exact text here before approval. Model: Voxtral Mini TTS. Voice: en_paul_neutral.</p>
</article>
<article class="v-card mcp-card" id="review">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">04</span>Review</p><button id="refresh" class="v-btn v-btn-secondary v-btn-sm">Refresh</button></div>
<h2 class="v-title">Requests &amp; audio</h2>
<div id="jobs" class="mcp-rows mcp-jobs"></div>
<p class="mcp-fine">Audio requires your account, expires after your chosen retention, and can be deleted now. No public download links.</p>
</article>
</div>
<div class="mcp-stack mcp-anchor mcp-access" id="access">
<section id="oauth-section" hidden><article class="v-card mcp-card">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">05</span>OAuth client access</p><span class="v-badge v-badge-info">Controlled trial</span></div>
<h2 class="v-title">Connect an MCP client</h2>
<p class="v-text">Use your client’s OAuth connection flow with endpoint <strong id="oauth-resource" class="v-mono"></strong>. Sign in to Vocs, review the client and callback destination, and approve the scopes you need.</p>
<p class="mcp-hint">This controlled trial uses short-lived access with no refresh tokens. Actual Dots and Vocs Code interoperability still needs a live connection test. Disconnect access below at any time; speech still needs your separate exact-text approval.</p>
<div id="oauth-grants" class="mcp-rows mcp-grants"></div>
</article></section>
<section id="clients-section" hidden><article class="v-card mcp-card">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">05</span>Client access</p><span class="v-badge v-badge-warn">Manual trial</span></div>
<h2 class="v-title">Manual bearer-token trial</h2>
<p class="v-text">Tokens last at most 5 minutes and are revoked by logout or session revocation. Dots and Vocs Code compatibility is unverified. This is a manual bearer-token trial, not a verified automatic connection.</p>
<div class="mcp-split">
<form id="client-form" class="mcp-form"><label class="v-field"><span class="v-label">Client</span><select class="v-input" id="client-id"><option value="dots">Dots</option><option value="vocs-code">Vocs Code</option></select></label><label class="v-check"><input type="checkbox" id="scope-models" checked disabled>Read models (models:read)</label><label class="v-check"><input type="checkbox" id="scope-speech">Request speech (speech:write)</label><label class="v-check"><input type="checkbox" id="scope-audio">Read private audio (audio:read)</label><label class="v-check"><input type="checkbox" id="client-consent">I authorize this client to use only the selected scopes through my current account session. Speech still requires my explicit approval.</label><div class="mcp-form-actions"><button id="issue-client" class="v-btn v-btn-primary">Issue 5-minute token</button></div></form>
<div class="mcp-side">
<div id="issued" class="mcp-token" hidden><label class="v-field"><span class="v-label">New token, shown only this time</span><input class="v-input" id="client-token" type="password" readonly autocomplete="off" spellcheck="false"></label><div class="mcp-form-actions"><button id="reveal-token" type="button" class="v-btn v-btn-secondary v-btn-sm">Reveal token</button><button id="hide-token" type="button" class="v-btn v-btn-secondary v-btn-sm">Discard displayed token</button></div><p id="token-expiry"></p><p>Manually copy only into a trusted client’s secure bearer-token setting. Never paste it into chat, a URL, or shared configuration. Leaving or hiding this page clears the display, not the server grant; revoke below to end access.</p></div>
<div id="clients" class="mcp-rows mcp-grants"></div>
</div>
</div>
</article></section>
</div>
</div>
</main>
</div>
<footer class="v-footer v-footer-slim"><div class="v-wrap v-wrap-wide"><div class="v-footer-base"><span>Vocs MCP Hub · Local-first preview · OpenRouter now, more capabilities next.</span><span>Follows your system theme</span></div></div></footer>
</body>
</html>`;
export const script = `const $=id=>document.getElementById(id);
let current=null,busy=false,state=null,epoch=0,policyReady=false,policyDirty=false,policyVersion=0,tokenTimer=null,tokenEpoch=0;
const keyAllowed=()=>!!state&&(state.liveTrial||state.mode==='live');
const tones={pending:'warn',approved:'info',running:'info',complete:'live',uncertain:'danger'};
function badge(status){const s=document.createElement('span');s.className='v-badge v-badge-'+(tones[status]||'plain');s.textContent=status;return s;}
function clearKey(){$('key').value='';$('consent').checked=false;}
function clearToken(){tokenEpoch++;if(tokenTimer)clearTimeout(tokenTimer);tokenTimer=null;$('client-token').value='';$('client-token').type='password';$('issued').hidden=true;$('reveal-token').textContent='Reveal token';$('token-expiry').textContent='';}
function invalidate(){epoch++;clearKey();clearToken();$('client-consent').checked=false;current=null;$('text').value='';}
addEventListener('pagehide',invalidate);addEventListener('beforeunload',invalidate);addEventListener('popstate',invalidate);
document.addEventListener('visibilitychange',()=>{if(document.hidden)invalidate();});
addEventListener('pageshow',()=>{clearKey();clearToken();});
function controls(){document.querySelectorAll('button').forEach(b=>b.disabled=busy);$('key').disabled=!keyAllowed()||busy;$('consent').disabled=!keyAllowed()||busy;$('save-key').disabled=!keyAllowed()||busy;$('disconnect').disabled=!keyAllowed()||busy;$('issue-client').disabled=!state?.clientAccess||busy;$('prepare').disabled=busy||!state||(state.liveTrial&&state.mode!=='live');$('approval').disabled=!!state?.liveTrial;$('retention').disabled=!!state?.liveTrial;}
async function api(path,data,method){const r=await fetch('/api/'+path,{method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json','X-Vocs-Intent':'dashboard'},body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j;}
function note(s){$('notice').textContent=s;}
function validText(){const text=$('text').value;if(state?.liveTrial&&new TextEncoder().encode(text).length>300)throw Error('Live trial text must be 300 UTF-8 bytes or fewer.');return text;}
async function refresh(generation=epoch){const s=await api('status');if(generation!==epoch||document.hidden)return;
state=s;if(!policyReady||!policyDirty){$('budget').value=s.policy.dailyMicros/1e6;$('retention').value=s.policy.retentionHours;$('approval').checked=s.policy.approvalRequired;policyReady=true;}
$('budget').max=s.liveTrial?'0.10':'10';if(s.liveTrial){$('retention').value=1;$('approval').checked=true;}$('text').maxLength=s.liveTrial?300:2000;
$('connection').textContent=s.mode+' · '+(s.keyConnected?'Key connected (encrypted by operator)':'No key connected')+' · Reserved today: $'+(s.reservedToday/1e6).toFixed(2)+(s.liveTrial?' · Live trial: one admitted request total, $0.10 reservation (no daily reset), approval required, 1-hour audio retention. Text limit: 300 UTF-8 bytes. Trial reserved: $'+((s.trialReserved||0)/1e6).toFixed(2)+(s.mode!=='live'?' Provider disabled: speech unavailable.':''):'');
$('oauth-section').hidden=!s.oauthAccess;$('oauth-resource').textContent=s.oauthResource||'';$('clients-section').hidden=!s.clientAccess;if(!s.clientAccess)clearToken();controls();$('jobs').replaceChildren();for(const j of s.jobs.slice().reverse()){const row=document.createElement('div');row.className='job';const p=document.createElement('p');p.textContent=j.id;p.append(badge(j.status));row.append(p);if(j.status==='pending'){const b=document.createElement('button');b.className='v-btn v-btn-primary v-btn-sm';b.textContent='Approve matching text · $0.10';b.onclick=()=>run(async g=>{await api('approve',{requestId:j.id,text:validText(),voice:'en_paul_neutral'});if(g===epoch)note('Approved. Execute the same request to generate audio.');});row.append(b);}if(j.status==='approved'&&current&&current.requestId===j.id){const b=document.createElement('button');b.className='v-btn v-btn-primary v-btn-sm';b.textContent='Execute approved request';b.onclick=()=>run(async g=>{const result=await api('speech',current);if(g===epoch)note('Request '+result.status);});row.append(b);}if(j.status==='complete'&&j.artifact&&j.audioExpires>Date.now()){const a=document.createElement('a');a.href='/audio/'+j.artifact;a.className='v-btn v-btn-outline v-btn-sm';a.textContent='Download private audio';row.append(a);const b=document.createElement('button');b.textContent='Delete audio';b.className='v-btn v-btn-danger v-btn-sm';b.onclick=()=>run(async g=>{await api('audio/'+j.artifact,undefined,'DELETE');if(g===epoch)note('Audio deleted.');});row.append(b);}$('jobs').append(row);}if(!s.jobs.length)$('jobs').textContent='Your requests will appear here.';
if(s.clientAccess){const result=await api('clients');if(generation!==epoch||document.hidden)return;$('clients').replaceChildren();for(const c of result.clients){const row=document.createElement('div');row.className='job';const p=document.createElement('p');p.textContent=c.clientId+' · '+c.scopes.join(', ')+' · expires '+new Date(c.expiresAt).toLocaleString();row.append(p);const b=document.createElement('button');b.className='v-btn v-btn-danger v-btn-sm';b.textContent='Revoke';b.onclick=()=>{clearToken();run(async g=>{await api('clients/'+encodeURIComponent(c.id),undefined,'DELETE');if(g===epoch)note('Client access revoked.');});};row.append(b);$('clients').append(row);}}
if(s.oauthAccess){const result=await api('oauth/grants');if(generation!==epoch||document.hidden)return;$('oauth-grants').replaceChildren();for(const c of result.grants){const row=document.createElement('div');row.className='job';const p=document.createElement('p');const active=!c.revokedAt&&c.expiresAt>Date.now();p.textContent=c.clientId+' · '+c.scopes.join(', ')+' · '+(c.revokedAt?'revoked':active?'expires '+new Date(c.expiresAt).toLocaleString():'expired');row.append(p);if(active){const b=document.createElement('button');b.className='v-btn v-btn-danger v-btn-sm';b.textContent='Revoke OAuth access';b.onclick=()=>run(async g=>{await api('oauth/grants/'+encodeURIComponent(c.id),undefined,'DELETE');if(g===epoch)note('OAuth client access revoked.');});row.append(b);}$('oauth-grants').append(row);}if(!result.grants.length)$('oauth-grants').textContent='No OAuth client grants.';}
controls();return s;}
async function run(fn){if(busy)return;busy=true;const g=epoch;controls();try{await fn(g);if(g===epoch&&!document.hidden)await refresh(g);}catch(e){if(g===epoch)note(e.message);}finally{busy=false;controls();}}
$('keys').onsubmit=e=>{e.preventDefault();const key=$('key').value,consent=$('consent').checked;clearKey();if(busy)return;if(!keyAllowed()){note('Demo mode cannot save provider keys.');return;}if(!consent){note('Explicit key-storage and transmission consent is required.');return;}run(async g=>{await api('key',{key,consent:true});if(g===epoch)note('Key stored encrypted by MCP Hub.');});};
$('disconnect').onclick=()=>{clearKey();clearToken();if(!keyAllowed())return;run(async g=>{await api('key',undefined,'DELETE');current=null;if(g===epoch)note('Key disconnected. Pending approvals cancelled; already dispatched work may finish.');});};
$('policy').oninput=()=>{policyDirty=true;policyVersion++;};$('policy').onsubmit=e=>{e.preventDefault();const savedVersion=policyVersion;run(async g=>{await api('policy',{dailyMicros:Math.round(Number($('budget').value)*1e6),retentionHours:state?.liveTrial?1:Number($('retention').value),approvalRequired:state?.liveTrial?true:$('approval').checked});if(g===epoch){if(savedVersion===policyVersion)policyDirty=false;note('Controls saved.');}});};
$('speech').onsubmit=e=>{e.preventDefault();run(async g=>{if(state?.liveTrial&&state.mode!=='live')throw Error('Live provider disabled. Speech is unavailable.');current={requestId:crypto.randomUUID(),text:validText(),voice:'en_paul_neutral'};const result=await api('speech',current);if(g===epoch)note('Request '+result.status+'. Text stays only in this page until you navigate away.');});};
$('client-form').onsubmit=e=>{e.preventDefault();const consent=$('client-consent').checked;$('client-consent').checked=false;if(busy)return;clearToken();if(!state?.clientAccess)return;if(!consent){note('Explicit consent to the selected client scopes is required.');return;}const scopes=['models:read'];if($('scope-speech').checked)scopes.push('speech:write');if($('scope-audio').checked)scopes.push('audio:read');const clientId=$('client-id').value,issuedEpoch=tokenEpoch;run(async g=>{const result=await api('clients',{clientId,scopes,consent:true});if(g!==epoch||issuedEpoch!==tokenEpoch||document.hidden)return;const remaining=new Date(result.expiresAt).getTime()-Date.now();if(!Number.isFinite(remaining)||remaining<=0){note('Token expired. Issue a new token if needed.');return;}$('client-token').value=result.token;$('client-token').type='password';$('issued').hidden=false;$('token-expiry').textContent='Expires '+new Date(result.expiresAt).toLocaleString();tokenTimer=setTimeout(clearToken,Math.min(remaining,300000));note('Token issued once. Actual client compatibility remains unverified.');});};
$('reveal-token').onclick=()=>{if(!$('client-token').value)return;const hidden=$('client-token').type==='password';$('client-token').type=hidden?'text':'password';$('reveal-token').textContent=hidden?'Mask token':'Reveal token';};$('hide-token').onclick=clearToken;
$('refresh').onclick=()=>run(async()=>{});clearKey();clearToken();controls();run(async()=>{});
`;
