import assert from "node:assert/strict";
import vm from "node:vm";
import {
  loginScript,
  loginScriptForProfile,
  loginHtml,
  loginHtmlForProfile,
  accountHtml,
  accountHtmlForProfile,
} from "../src/login/ui.ts";
import { PRODUCTION_LOGIN, STAGING_LOGIN } from "../src/login/profile.ts";
function harness(account = false, source = loginScript) {
  const listeners = {};
  const elements = Object.fromEntries(
    ["status", "start", "cancel", "logout", "account"]
      .filter((id) =>
        account
          ? !["start", "cancel"].includes(id)
          : !["logout", "account"].includes(id),
      )
      .map((id) => [
        id,
        {
          disabled: false,
          hidden: false,
          textContent: "",
          handlers: {},
          addEventListener(type, fn) {
            this.handlers[type] = fn;
          },
        },
      ]),
  );
  const calls = [],
    pending = [],
    navigation = [];
  vm.runInNewContext(source, {
    document: {
      querySelector: (selector) => elements[selector.slice(1)] || null,
    },
    URL,
    location: { assign: (url) => navigation.push(url) },
    addEventListener: (event, fn) => {
      listeners[event] = fn;
    },
    fetch: (url, init) => {
      calls.push({ url, init });
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  });
  return { elements, listeners, calls, pending, navigation };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (data) => ({ ok: true, json: async () => data });
// Initiation remains cancelable while its response is pending; don't follow a stale redirect.
{
  const h = harness();
  const started = h.elements.start.handlers.click();
  h.elements.start.handlers.click();
  assert.equal(h.calls.length, 1);
  h.elements.cancel.handlers.click();
  assert.match(h.elements.status.textContent, /Cancelling/);
  h.pending
    .shift()
    .resolve(response({ url: "https://auth.vocs.io/authorize?state=test" }));
  await tick();
  assert.equal(h.calls[1].url, "/login/cancel");
  h.pending.shift().resolve(response({ ok: true }));
  await started;
  assert.deepEqual(h.navigation, []);
  assert.match(h.elements.status.textContent, /cancelled/);
  assert.equal(h.elements.start.disabled, false);
  assert.equal(h.elements.cancel.disabled, false);
}
// Back/navigation invalidates a pending start too.
{
  const h = harness();
  const started = h.elements.start.handlers.click();
  h.listeners.pagehide();
  h.pending
    .shift()
    .resolve(response({ url: "https://auth.vocs.io/authorize?state=test" }));
  await tick();
  assert.equal(h.calls[1].url, "/login/cancel");
  h.pending.shift().resolve(response({ ok: true }));
  await started;
  assert.deepEqual(h.navigation, []);
}
// Network failure after cancel still makes one explicit cleanup request, without redirecting.
{
  const h = harness();
  const started = h.elements.start.handlers.click();
  h.elements.cancel.handlers.click();
  h.pending.shift().reject(Error("network"));
  await tick();
  assert.equal(h.calls[1].url, "/login/cancel");
  h.pending.shift().resolve(response({ ok: true }));
  await started;
  assert.deepEqual(h.navigation, []);
}
// A stale account response cannot overwrite local logout confirmation.
{
  const h = harness(true);
  h.listeners.pageshow();
  const logout = h.elements.logout.handlers.click();
  const old = h.pending.shift();
  h.pending.shift().resolve(response({ ok: true }));
  await logout;
  old.resolve(response({ subject: "stale-account" }));
  await tick();
  assert.equal(
    h.elements.account.textContent,
    "You are signed out of MCP Hub.",
  );
  assert.equal(h.elements.logout.hidden, true);
}
// Production UI is unchanged; staging accepts only its pinned issuer/client/callback.
assert.equal(loginScriptForProfile(PRODUCTION_LOGIN), loginScript);
assert.equal(loginHtmlForProfile(false, PRODUCTION_LOGIN), loginHtml(false));
assert.equal(accountHtmlForProfile(PRODUCTION_LOGIN), accountHtml);
assert.match(
  loginHtmlForProfile(false, STAGING_LOGIN),
  /existing staging account/,
);
assert.match(accountHtmlForProfile(STAGING_LOGIN), /models:read/);
assert.match(
  loginHtmlForProfile(false, STAGING_LOGIN),
  /<h1>Sign in to MCP Hub staging<\/h1>/,
);
assert.match(
  accountHtmlForProfile(STAGING_LOGIN),
  /<h1>Your staging MCP Hub account<\/h1>/,
);
const stagingScript = loginScriptForProfile(STAGING_LOGIN);
const valid = new URL(STAGING_LOGIN.issuer + "/authorize");
valid.search = new URLSearchParams({
  client_id: STAGING_LOGIN.clientId,
  redirect_uri: STAGING_LOGIN.origin + "/login/callback",
}).toString();
const bad = [
  "https://auth.vocs.io/authorize",
  "https://evil.test/authorize",
  valid.href.replace("/authorize?", "/other?"),
  valid.href.replace("mcp-hub-staging", "mcp-hub"),
  valid.href.replace(
    encodeURIComponent(STAGING_LOGIN.origin),
    encodeURIComponent(PRODUCTION_LOGIN.origin),
  ),
  valid.href + "&client_id=mcp-hub",
  valid.href +
    "&redirect_uri=" +
    encodeURIComponent(PRODUCTION_LOGIN.origin + "/login/callback"),
];
for (const url of [...bad, valid.href]) {
  const h = harness(false, stagingScript);
  const started = h.elements.start.handlers.click();
  h.pending.shift().resolve(response({ url }));
  await started;
  assert.deepEqual(h.navigation, url === valid.href ? [url] : []);
}
// The staging variant preserves cancellation/repeated-click behavior too.
{
  const h = harness(false, stagingScript);
  const started = h.elements.start.handlers.click();
  h.elements.start.handlers.click();
  assert.equal(h.calls.length, 1);
  h.elements.cancel.handlers.click();
  h.pending.shift().resolve(response({ url: valid.href }));
  await tick();
  assert.equal(h.calls[1].url, "/login/cancel");
  h.pending.shift().resolve(response({ ok: true }));
  await started;
  assert.deepEqual(h.navigation, []);
}
console.log(
  "Login UI checks passed: duplicate clicks, cancellation, Back, failure, stale account responses, and pinned staging redirect isolation.",
);
