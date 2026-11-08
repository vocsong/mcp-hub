import assert from "node:assert/strict";
import vm from "node:vm";
import { loginScript } from "../src/login/ui.ts";
function harness(account = false) {
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
  vm.runInNewContext(loginScript, {
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
console.log(
  "Login UI state checks passed: duplicate clicks, cancellation, Back, failure and stale account responses.",
);
