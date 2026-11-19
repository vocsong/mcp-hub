/** Frozen design template: capability UI changes must not enter the public mock.
 * src/preview-assets.ts derives the public page from it with guarded rewrites (each
 * must match exactly once), so this keeps the private wording those edits replace.
 * Vocs UI site shell; styles come from the shared same-origin stylesheet. */
import {
  aura,
  brandLink,
  headTags,
  icon,
  SHELL_SCRIPT,
  switcher,
} from "./ui/shell";

export const dashboard = `<!doctype html>
<html lang="en" data-product="mcp">
<head>${headTags("Vocs MCP Hub")}<script src="${SHELL_SCRIPT}" defer></script><script src="/app.js" defer></script></head>
<body class="v-root">
<a class="v-skip" href="#main">Skip to content</a>
<header class="v-topbar"><div class="v-wrap v-topbar-inner">${brandLink}<nav class="v-nav" aria-label="Sections"><a href="#connect">Connect</a><a href="#control">Control</a><a href="#try">Try it</a><a href="#review">Review</a></nav><div class="v-topbar-actions">${switcher}<a class="v-btn v-btn-secondary v-btn-sm" href="/login">Sign in</a></div></div></header>
<main id="main">
<section class="v-hero">${aura}<div class="v-wrap">
<p class="mcp-hero-badge"><span class="v-badge v-badge-info">Invite-only preview</span></p>
<p class="v-eyebrow">Your keys. Your control.</p>
<h1 class="v-display-xl">One home for<br><em>your AI capabilities.</em></h1>
<p class="v-lede">OpenRouter is the first connection. Private by design, with spending controls and temporary audio.</p>
<div class="v-hero-actions"><a class="v-btn v-btn-primary v-btn-lg" href="#how">Try the preview <span class="v-arrow">→</span></a><a class="v-btn v-btn-secondary v-btn-lg" href="/login">Sign in with Vocs</a></div>
</div></section>
<section class="v-section mcp-landing mcp-anchor" id="how" aria-labelledby="how-title"><div class="v-wrap mcp-stack">
<div class="v-section-head"><p class="v-eyebrow">How it works</p><h2 class="v-display-l" id="how-title">Connect, set limits, <em>review every request.</em></h2></div>
<div class="v-note mcp-notice">${icon.info()}<div id="notice" role="status">Loading your account…</div></div>
<div class="v-grid-2">
<article class="v-card mcp-card" id="connect">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">01</span>Connect</p></div>
<div class="mcp-card-title"><span class="v-glyph v-glyph-lg mcp-logo" aria-hidden="true">OR</span><h3 class="v-title">OpenRouter</h3></div>
<p class="mcp-endpoint"><span>Endpoint <strong>/openrouter</strong></span><span>models · speech</span></p>
<p id="connection" class="mcp-conn"></p>
<form id="keys"><label class="v-field"><span class="v-label">Provider API key</span><input class="v-input" id="key" type="password" autocomplete="off" placeholder="Never paste a key into chat"></label><label class="v-check"><input id="consent" type="checkbox">I consent to encrypted storage of this key until I disconnect it.</label><div class="mcp-form-actions"><button class="v-btn v-btn-primary">Save key</button><button type="button" id="disconnect" class="v-btn v-btn-secondary">Disconnect</button></div></form>
<p class="mcp-fine">Demo mode refuses real keys. Live setup requires your own provider account and approved authentication.</p>
</article>
<article class="v-card mcp-card" id="control">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">02</span>Control</p></div>
<h3 class="v-title">Your limits</h3>
<form id="policy" class="mcp-form"><label class="v-field"><span class="v-label">Daily reservation budget (USD)</span><input class="v-input" id="budget" type="number" min="0" max="10" step="0.01" required></label><label class="v-field"><span class="v-label">Audio retention (hours)</span><input class="v-input" id="retention" type="number" min="1" max="24" required></label><label class="mcp-toggle"><span>Approve every request</span><input id="approval" type="checkbox"></label><div class="mcp-form-actions"><button class="v-btn v-btn-primary">Save controls</button></div></form>
<p class="mcp-fine">Each request reserves $0.10. This is a local admission limit, not a guaranteed provider billing cap. Configure a provider-key limit too.</p>
</article>
</div>
<div class="v-grid-2">
<article class="v-card mcp-card" id="try">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">03</span>Try it</p></div>
<h3 class="v-title">Text to speech</h3>
<form id="speech" class="mcp-form"><label class="v-field"><span class="v-label">Text</span><textarea class="v-input" id="text" maxlength="2000" required placeholder="Write a short sentence…"></textarea></label><div class="mcp-form-actions"><button class="v-btn v-btn-primary">Prepare request</button></div></form>
<p class="mcp-fine">The local demo returns a test tone, not speech. Text is not stored. Review the text above, then approve below. For an MCP request, paste its exact text here before approval. Model: Voxtral Mini TTS. Voice: en_paul_neutral.</p>
</article>
<article class="v-card mcp-card" id="review">
<div class="mcp-card-head"><p class="v-eyebrow v-eyebrow-sm"><span class="mcp-step">04</span>Review</p><button id="refresh" class="v-btn v-btn-secondary v-btn-sm">Refresh</button></div>
<h3 class="v-title">Requests &amp; audio</h3>
<div id="jobs" class="mcp-rows mcp-jobs"></div>
<p class="mcp-fine">Audio requires your account, expires after your chosen retention, and can be deleted now. No public download links.</p>
</article>
</div>
</div></section>
</main>
<footer class="v-footer"><div class="v-wrap">
<div class="v-footer-grid">
<div>${brandLink}<p class="v-small mcp-footer-blurb">One home for your AI capabilities. OpenRouter first, more MCP services later.</p></div>
<div><h2>Hub</h2><ul><li><a href="#connect">Connect</a></li><li><a href="#control">Control</a></li><li><a href="#try">Try it</a></li><li><a href="#review">Review</a></li></ul></div>
<div><h2>Vocs</h2><ul><li><a href="https://vocs.io/">vocs.io</a></li><li><a href="https://code.vocs.io/">Vocs Code</a></li></ul></div>
<div><h2>Account</h2><ul><li><a href="/login">Sign in</a></li><li><a href="https://auth.vocs.io/account">Vocs account</a></li></ul></div>
</div>
<div class="v-footer-base"><span>Vocs MCP Hub · Local-first preview · OpenRouter now, more capabilities next.</span><span>Follows your system theme</span></div>
</div></footer>
</body>
</html>`;
