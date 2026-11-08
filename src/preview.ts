import { css } from "./dashboard";
import { html, previewScript, PREVIEW_VERSION } from "./preview-assets";
const headers = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; media-src blob:; img-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Vocs-Preview-Version": PREVIEW_VERSION,
};
export default {
  fetch(req: Request): Response {
    const path = new URL(req.url).pathname;
    if (!["GET", "HEAD"].includes(req.method))
      return Response.json(
        { error: "mock_preview_read_only", version: PREVIEW_VERSION },
        { status: 405, headers: { ...headers, Allow: "GET, HEAD" } },
      );
    if (path === "/health")
      return new Response(
        req.method === "HEAD"
          ? null
          : JSON.stringify({
              status: "ok",
              mode: "browser-only-mock",
              version: PREVIEW_VERSION,
              liveProvider: false,
              serverStorage: false,
            }),
        { headers: { ...headers, "Content-Type": "application/json" } },
      );
    const asset =
      path === "/" || path === "/dashboard"
        ? { body: html, type: "text/html; charset=utf-8" }
        : path === "/app.css"
          ? { body: css, type: "text/css" }
          : path === "/app.js"
            ? { body: previewScript, type: "text/javascript" }
            : null;
    if (!asset)
      return new Response(
        req.method === "HEAD"
          ? null
          : JSON.stringify({
              error:
                path === "/openrouter"
                  ? "mcp_not_enabled_in_mock_preview"
                  : "not_found",
            }),
        {
          status: path === "/openrouter" ? 503 : 404,
          headers: { ...headers, "Content-Type": "application/json" },
        },
      );
    return new Response(req.method === "HEAD" ? null : asset.body, {
      headers: { ...headers, "Content-Type": asset.type },
    });
  },
};
