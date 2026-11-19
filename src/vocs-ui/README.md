# Vocs UI — one design system for every Vocs surface

Vocs UI is the single visual language for **vocs.io, code.vocs.io, auth.vocs.io,
millie.vocs.io and mcp.vocs.io**. Every product keeps its own origin, but they read as one
website: the same top bar, wordmark, product switcher, type, colour, sign-in look and footer.

- **Direction — "Still + Glow".** Calm and minimal, with Apple-like structure: a soft canvas,
  borderless white cards, Inter, pill buttons and a frosted top bar. A slow, soft **aura** in the
  product's hue appears **only** behind heroes and the sign-in stage.
- **Theme** follows the system (`prefers-color-scheme`). There is no toggle.
- **Mark.** The `vocs.` wordmark is used everywhere, with the product name after it. The square
  `v.` tile is only for favicons and app icons.
- **Colour.** Every surface shares one set of neutrals, and each product adds one signature hue.

The reference prototype lives in [`../prototypes/`](../prototypes/index.html) (`?dir=glow`).
Screenshots of every screen in both themes are in `../prototypes/shots/sheet-glow-*.png`.

## Files

| File                     | What it is                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `vocs-ui.css`            | Tokens and shared components. Every class and token is prefixed `v-` / `--v-`.                        |
| `fonts.css`              | `@font-face` for Inter (opsz + wght) and Geist Mono (wght), latin, variable, relative URLs.           |
| `fonts/`                 | The two `.woff2` files and their SIL OFL 1.1 licences. Self-host them on each origin.                 |
| `favicons/<product>.svg` | The `v.` tile favicon. The dot carries the product hue.                                               |
| `version.json`           | System version. Bump it when tokens or components change.                                             |
| `vocs-ui.generated.ts`   | Not here. Emitted by `scripts/sync-design-system.mjs` for Workers that serve CSS and fonts from code. |

**Canonical source:** `vocsong/vocs.io` → `design/system/`. Other repos vendor a copy with
`node scripts/sync-design-system.mjs --vendor <dir>`, and nobody edits vendored copies.
In this repo, `npm run design:sync` regenerates `auth/src/vocs-ui.generated.ts` and
`code/worker/vocs-ui.generated.ts`. `npm run design:check` (part of `npm run check`) fails when
they drift.

## Product hues

| Product         | `data-product` | Light     | Dark      | Wordmark        |
| --------------- | -------------- | --------- | --------- | --------------- |
| vocs.io         | `vocs`         | `#0a66d8` | `#5aa9ff` | `vocs.`         |
| Vocs Code       | `code`         | `#6d3fd6` | `#a98bff` | `vocs. code`    |
| MCP Hub         | `mcp`          | `#a85500` | `#f5b544` | `vocs. mcp`     |
| Millie          | `millie`       | `#127a3e` | `#4ade80` | `vocs. millie`  |
| Account (login) | `account`      | `#1d1d1f` | `#f2f2f4` | `vocs. account` |

- Set `<html data-product="…">` on every page. The hue drives `--v-hue`, primary buttons, focus
  rings, the wordmark dot, the active nav item and the aura.
- **Sign-in borrows the requesting product's hue.** auth.vocs.io sets `data-product` to the
  product that sent the user (code, millie, mcp), so the flow feels continuous. The standalone
  account pages use `account`.
- **Status colours are semantic and never change per product.** `--v-live` (green) means live,
  success or gain; `--v-danger` (red) means error, loss or destructive; `--v-warn` (amber) is
  caution; `--v-info` (blue) is beta or info. In Millie, gains are green and losses red, the
  same as everywhere else.
- To show another product's colour (switcher, ecosystem maps), set `data-p="<product>"` on an
  element and use `var(--v-p)`.

## Tokens (see `vocs-ui.css` for values)

| Group  | Tokens                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas | `--v-bg` (page), `--v-bg-subtle` (alternate sections), `--v-surface` (cards), `--v-surface-2` (hover, inputs, quiet fills), `--v-surface-3`     |
| Text   | `--v-fg`, `--v-fg-2` (secondary), `--v-fg-3` (tertiary, captions)                                                                               |
| Lines  | `--v-line` (hairline), `--v-line-2` (strong: inputs, outlines), `--v-card-line` (transparent in light, a faint line in dark)                    |
| Hue    | `--v-hue`, `--v-hue-on` (text on a hue fill), `--v-hue-soft` (11% tint), `--v-hue-line`, `--v-ring`                                             |
| Status | `--v-live`, `--v-warn`, `--v-danger`, `--v-info`                                                                                                |
| Shape  | `--v-r-xs` 6 · `--v-r-s` 8 · `--v-r-m` 12 · `--v-r-l` 22 (cards) · `--v-r-xl` 28 (windows) · `--v-r-pill` (buttons, badges, segmented controls) |
| Depth  | `--v-shadow-1` (cards), `--v-shadow-2` (raised/hover), `--v-shadow-pop` (menus)                                                                 |
| Type   | `--v-font-sans` (Inter), `--v-font-mono` (Geist Mono)                                                                                           |
| Layout | `--v-wrap` 1120, `--v-wrap-wide` 1280 (apps), `--v-gutter`, `--v-gap` 18, `--v-header-h` 60                                                     |

## Type

- **Display:** Inter 650, tracking −0.04em, leading 1.03. Use `.v-display-xl` for heroes,
  `.v-display-l` for section titles, `.v-display-m` and `.v-h1` for page titles.
- **Second-clause emphasis.** Wrap the second clause of a hero headline in `<em>`; it renders in
  `--v-fg-3`, not italic. Example: "Every coding agent. <em>One interface.</em>"
- **Eyebrow** (`.v-eyebrow`): sentence case, weight 600, in the hue, above every hero and page title.
- **Body:** 16px with line-height 1.55. Use `.v-lede` for intros (secondary colour, max 38em).
- **Numbers:** `font-variant-numeric: tabular-nums` (`.v-num`). Money uses U+2212 `−` for minus.
- **Mono** (`.v-mono`): code, hosts, IDs, hashes and times only. Never use it for labels or headings.
- **Copy:** sentence case everywhere. No uppercase tracking labels; the old editorial `MONO
UPPERCASE` style is retired.

## Shell: one top bar, three variants

All variants use `.v-topbar > .v-wrap.v-topbar-inner`. Apps use `.v-wrap.v-wrap-wide`. The brand
always comes first:

```html
<a class="v-brand" href="/" aria-label="Vocs Code home"
  >vocs<span class="v-brand-dot">.</span><span class="v-brand-product">code</span></a
>
```

1. **Site** (vocs.io, code.vocs.io, the mcp.vocs.io landing): brand · `.v-nav` section links ·
   `.v-topbar-actions` holding the switcher and, where the product has one, a
   `.v-btn.v-btn-secondary.v-btn-sm` "Sign in" or an account avatar. Full `.v-footer` below.
2. **App** (signed-in Millie, MCP Hub dashboard, auth account): brand · switcher · `.v-avatar`
   with the account initial, linking to the account. Below it, `.v-app-layout` holds a
   `.v-sidenav` (product nav with groups and the `.v-sidenav-foot` user block) and
   `.v-app-main`. The account page uses `.v-settings` instead of a sidebar. Slim footer.
3. **Focus** (sign-in, consent, errors, invite or join, device linking): brand only, plus a
   quiet `.v-focus-note` ("Private by invitation") on the right. **No switcher, no nav.** The
   content is a `.v-stage` with a `.v-aura.v-aura-soft` and a centred `.v-stage-col` holding
   one `.v-card.v-panel-card`. Brand may be a `<span>` where the page must contain no links.

### Product switcher

The switcher is a `<details>` element, so it works with no JavaScript and under strict CSP.
`<summary>` has no button role, so it adds no extra buttons for tests. Add a small optional
script to close it on outside click or Esc where scripts are allowed.

```html
<details class="v-switcher">
  <summary class="v-icon-btn" aria-label="Vocs products">
    <!-- 3×3 dot-grid SVG, 18px, fill currentColor -->
  </summary>
  <div class="v-switcher-panel">
    <p class="v-switcher-head">Vocs</p>
    <a class="v-switcher-item" data-p="vocs" href="https://vocs.io/"
      ><span class="v-glyph">v.</span
      ><span
        ><span class="v-switcher-name">vocs.io</span
        ><span class="v-switcher-desc">Lab, projects and writing</span></span
      ></a
    >
    <!-- one item per product; aria-current="true" on the current one -->
    <div class="v-switcher-foot">
      <span>One Vocs account</span><span class="v-mono">vocs.io</span>
    </div>
  </div>
</details>
```

Items, in this order and with this exact copy:

| `data-p`  | Name      | Description                       | URL                            | Glyph | Visibility                                     |
| --------- | --------- | --------------------------------- | ------------------------------ | ----- | ---------------------------------------------- |
| `vocs`    | vocs.io   | Lab, projects and writing         | `https://vocs.io/`             | `v.`  | everywhere                                     |
| `code`    | Vocs Code | Every coding agent, one interface | `https://code.vocs.io/`        | `C`   | everywhere                                     |
| `mcp`     | MCP Hub   | Your AI capabilities              | `https://mcp.vocs.io/`         | `M`   | everywhere                                     |
| `millie`  | Millie    | Private service                   | `https://millie.vocs.io/`      | `Mi`  | **only inside signed-in Millie**, never public |
| `account` | Account   | Sign-in and security              | `https://auth.vocs.io/account` | `A`   | everywhere                                     |

Millie is private: it must never appear on a public page.

## Components (class reference)

| Component   | Classes                                                                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root        | `<body class="v-root">`; add `v-js` on `<html>` from script to enable `.v-reveal` (fade-up on scroll)                                                                                                                                        |
| Skip link   | `<a class="v-skip" href="#main">Skip to content</a>`                                                                                                                                                                                         |
| Buttons     | `.v-btn` + `.v-btn-primary` (hue fill) / `-secondary` (quiet fill) / `-outline` / `-ghost` (hue text) / `-danger` (red outline); sizes `-sm` 32 · default 40 · `-lg` 48; `-block`; trailing `<span class="v-arrow">→</span>` slides on hover |
| Card        | `.v-card` (22px radius, borderless in light, soft shadow) + `.v-card-pad`; `a.v-card` lifts on hover; `.v-card-dashed` for placeholders                                                                                                      |
| Badge       | `.v-badge` (dot + label, pill) + `-live` / `-info` / `-warn` / `-danger` / `-hue` / `-plain` (no dot)                                                                                                                                        |
| Chip        | `.v-chip` (outlined pill, e.g. harness names)                                                                                                                                                                                                |
| Note        | `.v-note` (quiet info box with optional leading icon) + `.v-note-danger`                                                                                                                                                                     |
| Forms       | `.v-field` > `.v-label` + `.v-input` (also `textarea.v-input`, `select.v-input`); `.v-check` (checkbox row); `.v-segmented` (pill radio group: children with `aria-pressed`, `aria-checked` or `aria-current="page"`); `.v-meter > i`        |
| Sections    | `.v-section` (+ `.v-section-alt` subtle band), `.v-section-head` (centred) or `.v-section-head-row` (title left, action right), `.v-grid-2/3/4`                                                                                              |
| Hero        | `.v-hero` (centred; `.v-hero-left` variant) containing `.v-aura` first, then `.v-wrap` with eyebrow, `.v-display-xl`, `.v-lede`, `.v-hero-actions`                                                                                           |
| Aura        | `<div class="v-aura" aria-hidden="true"><i></i><i></i><i></i></div>`; `.v-aura-soft` for the sign-in stage. Only in heroes and the focus stage.                                                                                              |
| Focus stage | `.v-stage` > `.v-aura.v-aura-soft` + `.v-stage-col` (or `-wide`) > `.v-card.v-panel-card`; inside: `.v-steps > i.on`, `.v-requester` (glyph + who/what), `.v-provider` rows, `.v-or`, `.v-note`; below the card: `.v-stage-foot`             |
| App         | `.v-app-layout` > `.v-sidenav` (`.v-sidenav-group`, links with 17px SVG icons, `aria-current="page"`, `.v-sidenav-foot` > `.v-me`) + `.v-app-main` > `.v-page-head`                                                                          |
| Data        | `.v-stat` (`-label`/`-value`/`-note`), `.v-panel` (`-head`/`-title`), `.v-list-row` (`.v-list-icon`, `.v-list-title`, `.v-list-sub`), `.v-table` in `.v-table-wrap`, `.v-kv`                                                                 |
| Settings    | `.v-settings` > `.v-settings-nav` + body of `.v-card` sections                                                                                                                                                                               |
| Footer      | `.v-footer` > `.v-wrap` > `.v-footer-grid` (brand blurb + 3 link columns) + `.v-footer-base`; slim apps/focus: `.v-footer.v-footer-slim`                                                                                                     |
| Glyph       | `.v-glyph` (36px rounded square with the product initial in `--v-p`/`--v-hue`), `.v-glyph-lg` 44px                                                                                                                                           |

Icons are inline SVG with a 24px viewBox, `stroke="currentColor"`, stroke-width 1.8, round caps
and joins (lucide-compatible). They render at 17–20px.

## Surface rules

- **Strict CSP is fine.** Nothing needs inline styles or scripts. Each origin serves
  `vocs-ui.css`, `fonts.css` (with URLs rewritten for that origin) and the fonts **from itself**.
  Add `font-src 'self'` (and `img-src 'self'` for the favicon) to the CSP. Never load fonts or
  CSS from another origin.
- **Product-specific CSS** lives with the product and uses only `--v-*` tokens. Don't hard-code
  colours, radii or fonts.
- **Keep behaviour and contracts.** A restyle must not change routes, IDs, form names, ARIA, copy
  that tests assert, or security headers other than the font and favicon allowances above.
- **Accessibility:**
  - Text meets WCAG AA in both themes. `--v-fg-3` is for captions only.
  - Interactive targets are at least 44px on touch layouts.
  - Every interactive element has a visible `:focus-visible` ring (in the hue).
  - `prefers-reduced-motion` stops the aura and reveal animations.
  - There is no horizontal scroll at 320 or 390px.
- **Verification for every surface:** light and dark at 390 and 1440 wide (plus 320 and 768 for
  focus pages), no console errors, no CSP violations, no horizontal overflow.
