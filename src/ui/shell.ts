/**
 * Vocs UI shell partials for MCP Hub pages (see src/vocs-ui/README.md).
 *
 * Plain strings only, no runtime imports: Node loads this file directly through
 * src/dashboard.ts and src/login/ui.ts in scripts/check-*.mjs. Every page is
 * strict-CSP safe: no inline style, script or style="" attributes. The shared
 * stylesheet, fonts and favicon are served same-origin by src/ui/assets.ts.
 */
export const STYLESHEET = "/ui/vocs-ui.css";
export const SHELL_SCRIPT = "/ui/vocs-ui.js";
export const FAVICON = "/favicon.svg";

const svg = (size: number, body: string) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Lucide-compatible icons (24px viewBox, stroke 1.8). */
export const icon = {
  lock: (size = 14) =>
    svg(
      size,
      '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    ),
  info: (size = 16) =>
    svg(size, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  alert: (size = 16) =>
    svg(size, '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>'),
  clock: (size = 16) =>
    svg(size, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  shield: (size = 17) =>
    svg(
      size,
      '<path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7l8-4z"/>',
    ),
  grid: (size = 17) =>
    svg(
      size,
      '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    ),
  link: (size = 17) =>
    svg(
      size,
      '<path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>',
    ),
  sliders: (size = 17) =>
    svg(
      size,
      '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    ),
  wave: (size = 17) =>
    svg(size, '<path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4"/>'),
  list: (size = 17) => svg(size, '<path d="M4 6h16M4 12h10M4 18h6"/>'),
};

const dots =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>';

/** <head> contents shared by every page. */
export const headTags = (title: string) =>
  `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title><link rel="icon" href="${FAVICON}" type="image/svg+xml"><link rel="preload" href="/ui/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="${STYLESHEET}">`;

const wordmark =
  'vocs<span class="v-brand-dot">.</span><span class="v-brand-product">mcp</span>';
/** The `vocs. mcp` wordmark linking home. */
export const brandLink = `<a class="v-brand" href="/" aria-label="MCP Hub home">${wordmark}</a>`;
/** The wordmark without a link, for pages that should not offer a way out mid-decision. */
export const brandMark = `<span class="v-brand" role="img" aria-label="Vocs MCP Hub">${wordmark}</span>`;

const item = (
  p: string,
  href: string,
  glyph: string,
  name: string,
  desc: string,
  current = false,
) =>
  `<a class="v-switcher-item" data-p="${p}" href="${href}"${current ? ' aria-current="true"' : ""}><span class="v-glyph">${glyph}</span><span><span class="v-switcher-name">${name}</span><span class="v-switcher-desc">${desc}</span></span></a>`;

/** Product switcher. Public items only: Millie is private and never listed here. */
export const switcher =
  `<details class="v-switcher"><summary class="v-icon-btn" aria-label="Vocs products">${dots}</summary><div class="v-switcher-panel"><p class="v-switcher-head">Vocs</p>` +
  item(
    "vocs",
    "https://vocs.io/",
    "v.",
    "vocs.io",
    "Lab, projects and writing",
  ) +
  item(
    "code",
    "https://code.vocs.io/",
    "C",
    "Vocs Code",
    "Every coding agent, one interface",
  ) +
  item(
    "mcp",
    "https://mcp.vocs.io/",
    "M",
    "MCP Hub",
    "Your AI capabilities",
    true,
  ) +
  item(
    "account",
    "https://auth.vocs.io/account",
    "A",
    "Account",
    "Sign-in and security",
  ) +
  '<div class="v-switcher-foot"><span>One Vocs account</span><span class="v-mono">vocs.io</span></div></div></details>';

export const aura =
  '<div class="v-aura" aria-hidden="true"><i></i><i></i><i></i></div>';
export const auraSoft =
  '<div class="v-aura v-aura-soft" aria-hidden="true"><i></i><i></i><i></i></div>';

/** The glyph + who/what block at the top of a focus card. */
export const requester = (who: string, what: string, glyph = "M") =>
  `<div class="v-requester"><span class="v-glyph v-glyph-lg" data-p="mcp" aria-hidden="true">${glyph}</span><div><div class="v-requester-who">${who}</div><div class="v-requester-what">${what}</div></div></div>`;

export interface FocusPage {
  /** Document title. */
  title: string;
  /** Extra <head> tags, e.g. the page script. */
  head?: string;
  /** Use the unlinked wordmark (consent decisions). */
  plainBrand?: boolean;
  /** Card contents. */
  card: string;
  /** Quiet row below the card. */
  foot?: string;
  wide?: boolean;
}

/** Focus shell: brand + "Private by invitation", aura stage, one centred card. */
export const focusPage = (page: FocusPage) =>
  `<!doctype html><html lang="en" data-product="mcp"><head>${headTags(page.title)}${page.head ?? ""}</head><body class="v-root"><header class="v-topbar"><div class="v-wrap v-topbar-inner">${page.plainBrand ? brandMark : brandLink}<div class="v-topbar-actions"><span class="v-focus-note">${icon.lock()}Private by invitation</span></div></div></header><main class="v-stage" id="main">${auraSoft}<div class="v-stage-col${page.wide ? " v-stage-col-wide" : ""}"><div class="v-card v-panel-card">${page.card}</div>${page.foot ? `<div class="v-stage-foot">${page.foot}</div>` : ""}</div></main></body></html>`;
