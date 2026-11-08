// Development-only visual fixture. Never imported by a Worker or deployed.
// No credentials, cookies, real sign-in or provider requests. Bound to loopback only.
import { createServer } from "node:http";
import { authPage, authCSS, authJS } from "../src/auth/ui.ts";
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost:8789").pathname;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  if (path === "/auth-assets/ui.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(authCSS);
  }
  if (path === "/auth-assets/ui.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(authJS);
  }
  if (path === "/api/account") {
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        user: { id: "fixture-only", email: "preview@example.test" },
        expiresAt: "2030-01-01T12:00:00.000Z",
        mcpAuthorized: false,
      }),
    );
  }
  if (path.startsWith("/api/auth/")) {
    if (path.endsWith("/sign-in/social")) {
      await new Promise((r) => setTimeout(r, 1800));
      res.statusCode = 503;
    }
    res.setHeader("Content-Type", "application/json");
    return res.end("{}");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const page =
    path === "/account"
      ? "account"
      : path === "/login-error"
        ? "error"
        : path === "/disabled"
          ? "disabled"
          : "login";
  res.end(
    authPage(page, {
      google: page !== "disabled",
      github: page !== "disabled",
    }).replace("Vocs account foundation", "LOCAL UI FIXTURE · No real login"),
  );
});
server.listen(8789, "127.0.0.1", () =>
  console.log(
    "Local UI fixture: http://localhost:8789/login (no real authentication)",
  ),
);
