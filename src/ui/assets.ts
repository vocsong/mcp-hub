/**
 * Same-origin Vocs UI assets for every Worker entry that renders HTML (this Worker
 * has no static-assets binding): the shared stylesheet, the switcher script, the
 * self-hosted fonts and the favicon. Nothing here reads bindings, cookies or
 * request bodies; only GET and HEAD are answered.
 */
import {
  VOCS_UI_HASH,
  vocsFavicons,
  vocsFontBytes,
  vocsFontFaceCss,
  vocsFontFiles,
  vocsUiCss,
} from "../vocs-ui/vocs-ui.generated";
import { mcpCss } from "./mcp-css";
import { FAVICON, SHELL_SCRIPT, STYLESHEET } from "./shell";

/** Fonts, tokens, components and the MCP Hub layer in one stylesheet. */
export const uiCss = `${vocsFontFaceCss("/ui/fonts/")}\n${vocsUiCss}\n${mcpCss}`;

/** Closes the product switcher on an outside click or Escape (works without it too). */
export const uiScript = `'use strict';
const openSwitchers=()=>document.querySelectorAll('details.v-switcher[open]');
document.addEventListener('click',e=>{const own=e.target instanceof Element?e.target.closest('details.v-switcher'):null;for(const d of openSwitchers())if(d!==own)d.open=false;});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;for(const d of openSwitchers()){d.open=false;d.querySelector('summary')?.focus();}});
`;

/** FNV-1a, enough for a validator that changes whenever the bytes do. */
function tag(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `"${VOCS_UI_HASH}-${(h >>> 0).toString(36)}"`;
}

const FONT_PREFIX = "/ui/fonts/";
const baseHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
const text = {
  [STYLESHEET]: { body: uiCss, type: "text/css; charset=utf-8" },
  [SHELL_SCRIPT]: { body: uiScript, type: "text/javascript; charset=utf-8" },
  [FAVICON]: { body: vocsFavicons.mcp, type: "image/svg+xml" },
} as const;
const etags = new Map(
  Object.entries(text).map(([path, asset]) => [path, tag(asset.body)]),
);
const fonts = new Map<string, Uint8Array<ArrayBuffer>>();

/** Answers the shared UI asset routes; null for every other request. */
export function serveUiAsset(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = new URL(request.url).pathname;
  const head = request.method === "HEAD";
  if (path.startsWith(FONT_PREFIX)) {
    const name = path.slice(FONT_PREFIX.length);
    if (!Object.hasOwn(vocsFontFiles, name)) return null;
    let bytes = fonts.get(name);
    if (!bytes) {
      // Decoded once per isolate; a fresh ArrayBuffer-backed copy is a valid BodyInit.
      bytes = new Uint8Array(vocsFontBytes(name)!);
      fonts.set(name, bytes);
    }
    return new Response(head ? null : bytes, {
      headers: {
        ...baseHeaders,
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }
  if (!Object.hasOwn(text, path)) return null;
  const asset = text[path as keyof typeof text];
  const etag = etags.get(path)!;
  const headers = {
    ...baseHeaders,
    "Content-Type": asset.type,
    // Revalidate every time: the HTML is no-store, so CSS must never lag behind it.
    "Cache-Control": "no-cache",
    ETag: etag,
  };
  if (request.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(head ? null : asset.body, { headers });
}
