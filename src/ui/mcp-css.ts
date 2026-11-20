/**
 * MCP Hub layer on top of Vocs UI. Only `--v-*` tokens: no hard-coded colours,
 * radii or fonts. Rows rendered by the page scripts are styled through their
 * containers (.mcp-rows > div), so the scripts never need extra wrappers.
 */
export const mcpCss = `
.mcp-stack{display:grid;gap:var(--v-gap)}
.mcp-stack>*{min-width:0}
.mcp-anchor,.mcp-card[id]{scroll-margin-top:calc(var(--v-header-h) + 20px)}

/* Focus pages: the h1 stays attribute-free (check scripts match <h1>…</h1>). */
.v-panel-card h1{margin:0;font-size:clamp(1.625rem,1.3rem + 1.2vw,2.125rem);font-weight:650;letter-spacing:-0.03em;line-height:1.12;text-wrap:balance;overflow-wrap:anywhere}
.v-panel-card p{margin:0}
.mcp-focus-title{display:grid;gap:8px}
.v-stage-foot{flex-wrap:wrap;row-gap:6px}
.v-stage-foot>*{white-space:nowrap}
.mcp-actions{display:grid;gap:10px}
.mcp-actions .v-btn-ghost{justify-self:center}
.mcp-status{min-height:1.25rem;font-size:.8125rem;line-height:1.5;text-align:center;color:var(--v-fg-2)}
.mcp-account{overflow-wrap:anywhere}
.mcp-hint{font-size:.8125rem;line-height:1.5;color:var(--v-fg-2)}
.mcp-facts{display:grid;gap:0;margin:0;border-radius:var(--v-r-m);background:var(--v-surface-2);padding:4px 16px}
.mcp-facts>div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:4px 16px;padding:12px 0;border-bottom:1px solid var(--v-line)}
.mcp-facts>div:last-child{border-bottom:0}
.mcp-facts dt{font-size:.8125rem;color:var(--v-fg-2)}
.mcp-facts dd{margin:0;display:grid;justify-items:start;gap:6px;font-size:.875rem;min-width:0;overflow-wrap:anywhere}
.mcp-uri{font-size:.75rem;color:var(--v-fg-2);overflow-wrap:anywhere}
.mcp-scopes{display:grid;gap:12px;margin:0;padding:0;border:0;min-width:0}
.mcp-scopes legend{padding:0;margin-bottom:12px}
.mcp-scopes .v-check{align-items:flex-start;padding:12px 14px;border:1px solid var(--v-line-2);border-radius:var(--v-r-m);background:var(--v-input-bg);color:var(--v-fg);cursor:pointer}
.mcp-scopes .v-check:has(input:checked){border-color:var(--v-hue-line);background:var(--v-hue-soft)}
.mcp-scope{display:grid;gap:2px;min-width:0}
.mcp-scope .v-mono{font-size:.8125rem;overflow-wrap:anywhere}
.mcp-scope-desc{font-size:.8125rem;color:var(--v-fg-2)}
.mcp-consent{display:grid;gap:22px}
.mcp-decide{display:flex;flex-wrap:wrap;gap:10px}
.mcp-decide .v-btn{flex:1 1 180px}
@media (max-width:480px){.mcp-facts>div{grid-template-columns:1fr}}

/* Landing */
.mcp-hero-badge{display:flex;justify-content:center;margin:0 0 18px}
.v-hero-left .mcp-hero-badge{justify-content:flex-start}
.mcp-landing{padding-top:0}
.mcp-landing .v-section-head{margin-bottom:28px}
.mcp-footer-blurb{margin:12px 0 0;max-width:24em}

/* Cards */
.mcp-card{display:flex;flex-direction:column;gap:16px;min-width:0;padding:clamp(20px,3vw,28px)}
.mcp-card>*{margin:0}
.mcp-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px}
.mcp-card-head .v-eyebrow{margin:0}
.mcp-step{display:inline-grid;place-items:center;min-width:26px;height:22px;padding:0 7px;border-radius:var(--v-r-pill);background:var(--v-hue-soft);color:var(--v-hue);font-size:.75rem;font-weight:650;letter-spacing:0;font-variant-numeric:tabular-nums}
.mcp-card-title{display:flex;align-items:center;gap:12px}
.mcp-card-title .v-title{margin:0}
.mcp-logo{border-radius:var(--v-r-m);background:var(--v-surface-2);color:var(--v-fg);font-size:.9375rem}
.mcp-endpoint{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:10px 12px;border-radius:var(--v-r-s);background:var(--v-surface-2);font-size:.8125rem;line-height:1.45;color:var(--v-fg-2);overflow-wrap:anywhere}
.mcp-endpoint strong{font-family:var(--v-font-mono);font-weight:500;color:var(--v-fg)}
.mcp-conn{display:flex;gap:9px;align-items:baseline;font-size:.875rem;line-height:1.5;color:var(--v-fg-2);overflow-wrap:anywhere}
.mcp-conn::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:var(--v-fg-3);transform:translateY(-1px)}
.mcp-conn:empty{display:none}
.mcp-form{display:grid;gap:14px}
.mcp-form-actions{display:flex;flex-wrap:wrap;gap:8px}
.mcp-card .v-text .v-mono{font-size:.92em;font-weight:500;overflow-wrap:anywhere}
.mcp-card>.mcp-fine{margin-top:auto;font-size:.8125rem;line-height:1.5;color:var(--v-fg-2)}
.v-check:has(input:disabled){opacity:.7}
.v-check input:disabled{cursor:not-allowed}
.mcp-disabled{display:grid;gap:6px;padding:16px 18px;border-radius:var(--v-r-m)}
.mcp-disabled strong{font-size:.9375rem;font-weight:600;color:var(--v-fg)}
.mcp-disabled p{margin:0;font-size:.8125rem;line-height:1.5;color:var(--v-fg-2)}

/* "Approve every request" as a switch; still a native checkbox. */
.mcp-toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;font-size:.9375rem;color:var(--v-fg);cursor:pointer}
.mcp-toggle input{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:44px;height:26px;margin:0;border-radius:var(--v-r-pill);background:var(--v-line-2);cursor:pointer;transition:background-color .25s var(--v-ease)}
.mcp-toggle input::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--v-surface);box-shadow:var(--v-shadow-1);transition:transform .3s var(--v-ease-out)}
.mcp-toggle input:checked{background:var(--v-hue)}
.mcp-toggle input:checked::after{transform:translateX(18px)}
.mcp-toggle input:focus-visible{outline:2px solid var(--v-hue);outline-offset:2px}
.mcp-toggle:has(input:disabled){cursor:not-allowed}
.mcp-toggle input:disabled{opacity:.55;cursor:not-allowed}
@media (prefers-color-scheme:dark){.mcp-toggle input::after{background:var(--v-fg)}}

.mcp-notice{align-items:flex-start;font-size:.875rem;line-height:1.5}
.mcp-notice>div{min-width:0;overflow-wrap:anywhere}

/* Script-rendered rows: containers carry the styling. */
.mcp-rows{display:grid;font-size:.875rem;color:var(--v-fg-3)}
.mcp-rows>div{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 0;border-bottom:1px solid var(--v-line);color:var(--v-fg)}
.mcp-rows>div:last-child{border-bottom:0}
.mcp-rows>div>p{margin:0;min-width:0;overflow-wrap:anywhere}
.mcp-rows>div>a{text-decoration:none}
.mcp-rows:not(:empty):not(:has(>*)),.mcp-empty{margin:0;padding:22px 16px;border:1px dashed var(--v-line-2);border-radius:var(--v-r-m);text-align:center;font-size:.875rem;color:var(--v-fg-3)}
.mcp-jobs>div>p{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-family:var(--v-font-mono);font-size:.75rem;color:var(--v-fg-2)}
.mcp-jobs .v-badge{order:-1;font-family:var(--v-font-sans);text-transform:capitalize}
.mcp-meta{margin:0 0 4px;font-size:.8125rem;color:var(--v-fg-2);font-variant-numeric:tabular-nums}
.mcp-grants>div{justify-content:space-between}
.mcp-grants>div>p{flex:1 1 240px;font-size:.8125rem;color:var(--v-fg-2)}
.mcp-grants>div>p:only-child{color:var(--v-fg-3)}
.mcp-grants>div>button{flex:none}

.mcp-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px 32px;align-items:start}
.mcp-split>*{min-width:0}
.mcp-side{display:grid;gap:16px}
.mcp-token{display:grid;gap:12px;padding:16px;border-radius:var(--v-r-m);background:var(--v-surface-2)}
.mcp-token .v-input{font-family:var(--v-font-mono);font-size:.8125rem}
.mcp-token p{margin:0;font-size:.8125rem;line-height:1.5;color:var(--v-fg-2)}
@media (max-width:860px){.mcp-split{grid-template-columns:1fr}}

/* Dashboard app shell */
.mcp-nav-access{display:none}
.v-sidenav .mcp-nav-access{display:none}
.v-app-layout:has(#oauth-section:not([hidden])) .v-sidenav .mcp-nav-access,.v-app-layout:has(#clients-section:not([hidden])) .v-sidenav .mcp-nav-access{display:flex}
.mcp-page-head{margin-bottom:24px}
.mcp-page-head .v-display-m{margin-top:2px}
.mcp-app-foot{padding-block:20px 32px}
@media (max-width:980px){.v-app-main{padding-top:20px}.v-sidenav{gap:4px;padding-bottom:4px}.v-sidenav a{padding:8px 12px}}
@media (pointer:coarse){.v-sidenav a,.v-switcher-item{min-height:44px}.v-icon-btn{width:44px;height:44px}}
`;
