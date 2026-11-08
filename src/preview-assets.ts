/**
 * Public mock-only preview. NO account, storage, provider, tenant or secret bindings.
 * Only static GET/HEAD resources. All interaction runs in browser memory.
 */
import { dashboard, css } from "./dashboard";
export const PREVIEW_VERSION = "neutral-preview-v1";
export const html = dashboard
  .replace("INVITE-ONLY PREVIEW", "PUBLIC DESIGN PREVIEW")
  .replace("YOUR KEYS. YOUR CONTROL.", "A CALMER WAY TO CONNECT.")
  .replace(
    "OpenRouter is the first connection. Private by design, with spending controls and temporary audio.",
    "Explore the future home of your AI connections. Start with OpenRouter, try the controls, and help shape what comes next.",
  )
  .replace(
    "Loading your account…",
    "Interactive mock preview. No sign-in, real keys, API calls or charges. Text and demo audio stay in this tab’s memory and disappear when you reload.",
  )
  .replace(
    "Endpoint <strong>/openrouter</strong>",
    "Planned endpoint <strong>/openrouter</strong>",
  )
  .replace(
    /<form id="keys">[\s\S]*?<\/form>/,
    '<div class="disabled-panel"><strong>Provider connection is not enabled</strong><p>Real API keys are not accepted in this preview. Secure account sign-in and provider connections come next.</p></div>',
  )
  .replace(
    "Demo mode refuses real keys. Live setup requires your own provider account and approved authentication.",
    "This is a browser-only interaction demo. The MCP endpoint and live OpenRouter speech service are not connected.",
  )
  .replace("Daily reservation budget (USD)", "Simulated session budget (USD)")
  .replace("Audio retention (hours)", "Simulated audio expiry (hours)")
  .replace(
    "Each request reserves $0.10. This is a local admission limit, not a guaranteed provider billing cap. Configure a provider-key limit too.",
    "Each demo request uses $0.10 of simulated budget. No money is spent. These controls reset when you reload.",
  )
  .replace("Text to speech</h2>", "Try the speech workflow</h2>")
  .replace(
    "The local demo returns a test tone, not speech. Text is not stored. Review the text above, then approve below. For an MCP request, paste its exact text here before approval. Model: Voxtral Mini TTS. Voice: en_paul_neutral.",
    "This demo creates a one-second test tone, not spoken words. Review the text above before approval. Nothing you type is sent to our server or OpenRouter.",
  )
  .replace(
    "Audio requires your account, expires after your chosen retention, and can be deleted now. No public download links.",
    "Demo audio exists only in this tab as a temporary browser file. Delete it here or reload to clear all demo state. A downloaded copy remains on your device.",
  )
  .replace(
    "VOCS MCP HUB · Local-first preview · OpenRouter now, more capabilities next.",
    "VOCS MCP HUB · Public mock preview · " +
      PREVIEW_VERSION +
      "<br>No accounts or provider connections are active. Ordinary hosting request metadata may be processed by Cloudflare.",
  );
export const previewScript = String.raw`
'use strict';
const $=id=>document.getElementById(id);
let jobs=[],used=0,policy={budget:1,approval:true,hours:24};
function note(s){$('notice').textContent=s;}
function dispose(j){if(j.url){URL.revokeObjectURL(j.url);delete j.url;}}
function tone(){const rate=8000,bytes=new Uint8Array(44+rate*2),v=new DataView(bytes.buffer);const str=(s,o)=>Array.from(s).forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));str('RIFF',0);v.setUint32(4,bytes.length-8,true);str('WAVEfmt ',8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str('data',36);v.setUint32(40,rate*2,true);for(let i=0;i<rate;i++)v.setInt16(44+i*2,Math.sin(i*2*Math.PI*440/rate)*1800,true);return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));}
function execute(j){if(j.state!=='approved')return;if(Date.now()>j.approvalExpiry){j.state='expired';note('Approval expired. Prepare a new request.');render();return;}if(used+10>Math.round(policy.budget*100)){note('Simulated budget reached. Increase the session budget or reload to reset.');return;}j.state='complete';used+=10;j.url=tone();j.expires=Date.now()+policy.hours*3600000;delete j.text;note('Demo complete. Download the test tone below. No API request or charge was made.');render();}
function button(label,fn,secondary=false){const b=document.createElement('button');b.type='button';b.textContent=label;if(secondary)b.className='secondary';b.onclick=fn;return b;}
function render(){
 $('connection').textContent='Not connected · Mock-only preview';
 $('jobs').replaceChildren();
 const total=document.createElement('p');total.className='preview-meta';total.textContent='Simulated spend: $'+(used/100).toFixed(2)+' / $'+policy.budget.toFixed(2);$('jobs').append(total);
 if(!jobs.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Your demo requests will appear here.';$('jobs').append(empty);}
 for(const j of jobs.slice().reverse()){
  if(j.url&&j.expires<=Date.now()){dispose(j);j.state='expired';}
  const row=document.createElement('div');row.className='job';const p=document.createElement('p');p.textContent=j.id+' · '+j.state;row.append(p);
  if(j.state==='pending')row.append(button('Approve matching text · demo $0.10',()=>{if(Date.now()>j.approvalExpiry){j.state='expired';note('Approval expired. Prepare a new request.');}else if($('text').value!==j.text){note('Text changed. Restore the exact original text or prepare a new request.');}else{j.state='approved';note('Approved for this demo. Execute when ready.');}render();}));
  if(j.state==='approved')row.append(button('Execute demo request',()=>execute(j)));
  if(j.url){const a=document.createElement('a');a.href=j.url;a.download='vocs-demo-test-tone.wav';a.textContent='Download test tone';row.append(a);row.append(button('Delete audio',()=>{dispose(j);j.state='deleted';note('Demo audio removed from this tab. Already-downloaded copies remain on your device.');render();},true));}
  if(j.state==='pending'||j.state==='approved')row.append(button('Cancel',()=>{delete j.text;j.state='cancelled';note('Demo request cancelled.');render();},true));
  $('jobs').append(row);
 }
}
$('budget').value='1';$('retention').value='24';$('approval').checked=true;
$('policy').onsubmit=e=>{e.preventDefault();const budget=Number($('budget').value),hours=Number($('retention').value);if(!Number.isFinite(budget)||budget<0||budget>10||!Number.isInteger(hours)||hours<1||hours>24){note('Use a budget from $0 to $10 and an expiry from 1 to 24 hours.');return;}policy={budget,approval:$('approval').checked,hours};note('Demo controls saved for this tab. No account settings were changed.');render();};
$('speech').onsubmit=e=>{e.preventDefault();const text=$('text').value;if(!text.trim()||new TextEncoder().encode(text).length>2000){note('Enter between 1 and 2,000 UTF-8 bytes of sample text.');return;}if(jobs.length>=50){note('This demo allows 50 requests per tab. Reload to reset.');return;}const j={id:crypto.randomUUID(),text,state:policy.approval?'pending':'approved',approvalExpiry:Date.now()+900000};jobs.push(j);note('Demo request prepared. Review the exact text, then approve.');if(!policy.approval)execute(j);render();};
$('refresh').textContent='Refresh demo';$('refresh').onclick=render;
window.addEventListener('pagehide',()=>jobs.forEach(dispose));
setInterval(render,60000);render();
`;
