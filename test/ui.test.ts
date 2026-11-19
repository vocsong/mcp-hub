/** Vocs UI restyle contract: strict-CSP pages, same-origin assets, guarded public rewrites. */
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import preview from "../src/preview";
import { html as previewHtml } from "../src/preview-assets";
import { dashboard as template } from "../src/preview-template";
import { dashboard } from "../src/dashboard";
import {
  loginHtml,
  accountHtml,
  loginHtmlForProfile,
  accountHtmlForProfile,
} from "../src/login/ui";
import { STAGING_LOGIN } from "../src/login/profile";
import { consentHtml, signInRequiredHtml } from "../src/oauth-ui";
import { rewrite } from "../src/ui/rewrite";
import { serveUiAsset, uiCss } from "../src/ui/assets";
import { vocsFontFiles } from "../src/vocs-ui/vocs-ui.generated";

const consent = (extra: Partial<Parameters<typeof consentHtml>[0]> = {}) =>
  consentHtml({
    clientName: 'Test <script>alert("x")</script>',
    redirectHost: "localhost",
    redirectUri: "http://localhost:3000/callback?a=1&b=2",
    redirectIsLoopback: true,
    resource: "https://mcp.vocs.io/openrouter",
    handle: "handle-value",
    scopes: ["models:read", "speech:write"],
    staging: false,
    ...extra,
  });
const site = { preview: previewHtml, dashboard };
const focus = {
  login: loginHtml(false),
  loginError: loginHtml(true),
  account: accountHtml,
  stagingLogin: loginHtmlForProfile(false, STAGING_LOGIN),
  stagingAccount: accountHtmlForProfile(STAGING_LOGIN),
  signInRequired: signInRequiredHtml(),
  consent: consent(),
};
const pages: Record<string, string> = { ...site, ...focus };
/** Same-origin URLs a page loads or links to that this Worker must serve. */
const assets = (page: string) =>
  [...page.matchAll(/(?:href|src)="(\/[^"#]+)"/g)]
    .map((m) => m[1])
    .filter((p) => /^\/(ui\/|favicon\.svg|app\.(css|js)$)/.test(p));

describe("guarded rewrites", () => {
  it("throws when an edit matches nothing or more than once", () => {
    expect(() => rewrite("abc", [["x", "y"]])).toThrow(/exactly one match/);
    expect(() => rewrite("a a", [["a", "b"]])).toThrow(/found 2/);
    expect(() => rewrite("<form id=k>", [[/<form id="k">/, ""]])).toThrow();
    expect(() => rewrite("abc", [["x", "y", "all"]])).toThrow(/at least one/);
  });
  it("applies edits in order, literally, and replaces all when asked", () => {
    expect(
      rewrite("cost a, a", [
        ["cost", "$0.10 $& $1"],
        ["a", "b", "all"],
      ]),
    ).toBe("$0.10 $& $1 b, b");
  });
  it("removes every private template phrase from the public mock", () => {
    for (const phrase of [
      'id="keys"',
      'type="password"',
      'id="consent"',
      "Provider API key",
      "Invite-only preview",
      "Your keys. Your control.",
      "Loading your account…",
      "Local-first preview",
      "Demo mode refuses real keys",
      "Daily reservation budget",
      "Audio requires your account",
      "Text to speech</h3>",
    ]) {
      expect(template, phrase).toContain(phrase);
      expect(previewHtml, phrase).not.toContain(phrase);
    }
    expect(previewHtml).toContain("Provider connection is not enabled");
  });
});

describe("Vocs UI pages", () => {
  it("are strict-CSP safe, amber MCP Hub pages on the shared stylesheet", () => {
    for (const [name, page] of Object.entries(pages)) {
      expect(page, name).not.toMatch(/<style|\sstyle=/i);
      for (const tag of page.match(/<script\b[^>]*>/g) ?? [])
        expect(tag, name).toMatch(/\ssrc="\/[^"]+"/);
      expect(page, name).toContain('<html lang="en" data-product="mcp">');
      expect(page, name).toContain('<body class="v-root">');
      expect(page, name).toContain(
        '<link rel="stylesheet" href="/ui/vocs-ui.css">',
      );
      expect(page, name).toContain(
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
      );
      expect(page, name).toMatch(
        /class="v-brand"[^>]*>vocs<span class="v-brand-dot">\.<\/span><span class="v-brand-product">mcp<\/span>/,
      );
      // Millie is private: never named on any MCP Hub page.
      expect(page, name).not.toMatch(/millie/i);
    }
  });
  it("site and app shells offer the public product switcher with MCP Hub current", () => {
    for (const [name, page] of Object.entries(site)) {
      const items = [
        ...page.matchAll(
          /<a class="v-switcher-item" data-p="([a-z]+)" href="([^"]+)"( aria-current="true")?/g,
        ),
      ].map((m) => [m[1], m[2], !!m[3]]);
      expect(items, name).toEqual([
        ["vocs", "https://vocs.io/", false],
        ["code", "https://code.vocs.io/", false],
        ["mcp", "https://mcp.vocs.io/", true],
        ["account", "https://auth.vocs.io/account", false],
      ]);
      expect(page, name).toContain('<details class="v-switcher">');
    }
    expect(previewHtml).toContain(
      '<a class="v-btn v-btn-secondary v-btn-sm" href="/login">Sign in</a>',
    );
    expect(previewHtml).toContain(
      "One home for<br><em>your AI capabilities.</em>",
    );
    expect(dashboard).toContain('<a class="v-avatar" href="/account"');
  });
  it("focus pages use the stage, one card and no switcher or nav", () => {
    for (const [name, page] of Object.entries(focus)) {
      expect(page, name).toContain(
        '<main class="v-stage" id="main"><div class="v-aura v-aura-soft"',
      );
      expect(page, name).toContain('<div class="v-card v-panel-card">');
      expect(page, name).toContain("Private by invitation");
      expect(page, name).not.toContain("v-switcher");
      expect(page, name).not.toContain("v-nav");
      expect(page, name).toMatch(/<h1>[^<]+<\/h1>/);
    }
    expect(focus.loginError).toContain("v-note-danger");
    expect(focus.login).not.toContain("v-note-danger");
    expect(focus.stagingLogin).toContain(
      '<div class="v-requester-what">MCP Hub staging</div>',
    );
  });
  it("consent escapes client strings and keeps the form contract", () => {
    const page = consent();
    expect(page).toContain(
      "Authorize Test &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(page).not.toContain("<script>");
    expect(page).toContain("http://localhost:3000/callback?a=1&amp;b=2");
    expect(page.match(/name="handle" value="([^"]+)"/)?.[1]).toBe(
      "handle-value",
    );
    expect(
      page.match(
        /<input type="checkbox" name="scope" value="([^"]+)" checked>/g,
      ),
    ).toHaveLength(2);
    expect(page).toContain(
      '<button class="v-btn v-btn-primary v-btn-lg" name="decision" value="approve">',
    );
    expect(page).toContain(
      '<button class="v-btn v-btn-secondary v-btn-lg" name="decision" value="deny">',
    );
    expect(page).toContain("Unverified");
    expect(page).toContain("loopback");
    // The decision page offers no navigation away: the wordmark is not a link.
    expect(page).not.toMatch(/<a\s/);
    const verified = consent({
      clientDomain: "client.example",
      redirectIsLoopback: false,
      staging: true,
    });
    expect(verified).toContain(
      '<span class="v-badge v-badge-live">Verified</span>',
    );
    expect(verified).not.toContain("loopback");
    expect(verified).toContain("This staging service lists models only.");
  });
});

describe("same-origin UI assets", () => {
  const get = (path: string, init?: RequestInit) =>
    serveUiAsset(new Request("https://mcp.vocs.io" + path, init));
  it("serves one stylesheet with fonts rewritten to /ui/fonts/ and revalidation", async () => {
    const r = get("/ui/vocs-ui.css")!;
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(r.headers.get("Cache-Control")).toBe("no-cache");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const css = await r.text();
    expect(css).toBe(uiCss);
    expect(css).toContain("url('/ui/fonts/inter-latin-var.woff2')");
    expect(css).not.toContain("./fonts/");
    expect(css).toContain("[data-product='mcp']");
    expect(css).toContain("prefers-color-scheme: dark");
    const etag = r.headers.get("ETag")!;
    expect(etag).toMatch(/^"[^"]+"$/);
    const cached = get("/ui/vocs-ui.css", {
      headers: { "If-None-Match": etag },
    })!;
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
  });
  it("serves every font as immutable woff2, intact on repeat requests", async () => {
    for (const name of Object.keys(vocsFontFiles))
      for (let i = 0; i < 2; i++) {
        const r = get("/ui/fonts/" + name)!;
        expect(r.headers.get("Content-Type")).toBe("font/woff2");
        expect(r.headers.get("Cache-Control")).toBe(
          "public, max-age=31536000, immutable",
        );
        const bytes = new Uint8Array(await r.arrayBuffer());
        expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("wOF2");
        expect(bytes.length).toBe(atob(vocsFontFiles[name]).length);
      }
  });
  it("serves the MCP favicon and the switcher script, GET and HEAD only", async () => {
    const icon = get("/favicon.svg")!;
    expect(icon.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await icon.text()).toMatch(/^<svg /);
    const script = await get("/ui/vocs-ui.js")!.text();
    expect(script).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/,
    );
    expect(await get("/ui/vocs-ui.css", { method: "HEAD" })!.text()).toBe("");
    for (const path of [
      "/ui/fonts/missing.woff2",
      "/ui/fonts/constructor",
      "/ui/fonts/..%2Fvocs-ui.css",
      "/ui/other.css",
      "/ui/",
      "/favicon.ico",
    ])
      expect(get(path), path).toBeNull();
    expect(get("/ui/vocs-ui.css", { method: "POST" })).toBeNull();
  });
});

describe("every HTML entry serves the assets its pages use", () => {
  it("public mock preview", async () => {
    const r = preview.fetch(new Request("https://mcp.vocs.io/"));
    expect(r.headers.get("Content-Security-Policy")).toContain(
      "font-src 'self'",
    );
    const page = await r.text();
    const used = assets(page);
    expect(used).toEqual(
      expect.arrayContaining([
        "/ui/vocs-ui.css",
        "/favicon.svg",
        "/ui/fonts/inter-latin-var.woff2",
        "/ui/vocs-ui.js",
        "/app.js",
      ]),
    );
    for (const path of used)
      expect(
        preview.fetch(new Request("https://mcp.vocs.io" + path)).status,
        path,
      ).toBe(200);
    expect(
      await preview.fetch(new Request("https://mcp.vocs.io/app.css")).text(),
    ).toBe(uiCss);
  });
  it("private dashboard", async () => {
    const r = await SELF.fetch("http://localhost:8787/dashboard");
    expect(r.headers.get("Content-Security-Policy")).toContain(
      "font-src 'self'",
    );
    const page = await r.text();
    expect(page).toBe(dashboard);
    for (const path of assets(page))
      expect(
        (await SELF.fetch("http://localhost:8787" + path)).status,
        path,
      ).toBe(200);
  });
});
