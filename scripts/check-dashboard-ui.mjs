import assert from "node:assert/strict";
import vm from "node:vm";
import { dashboard, script } from "../src/dashboard.ts";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (data, ok = true) => ({ ok, json: async () => data });
const status = (extra = {}) => ({
  mode: "live",
  liveTrial: true,
  clientAccess: true,
  keyConnected: false,
  keyConsent: null,
  reservedToday: 0,
  policy: { dailyMicros: 100000, retentionHours: 1, approvalRequired: true },
  jobs: [],
  ...extra,
});
function harness() {
  const events = {},
    timers = new Map();
  let timerId = 0;
  const make = () => ({
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    type: "password",
    textContent: "",
    children: [],
    append(x) {
      this.children.push(x);
    },
    replaceChildren() {
      this.children = [];
    },
  });
  const elements = Object.fromEntries(
    [...dashboard.matchAll(/id="([^"]+)"/g)].map((x) => [x[1], make()]),
  );
  elements["client-id"].value = "dots";
  const pending = [],
    calls = [];
  const document = {
    hidden: false,
    getElementById: (id) => elements[id],
    createElement: make,
    querySelectorAll: () => Object.values(elements),
    addEventListener: (name, fn) => (events[name] = fn),
  };
  vm.runInNewContext(script, {
    document,
    addEventListener: (name, fn) => (events[name] = fn),
    fetch: (url, init) => {
      calls.push({ url, init });
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
    crypto: { randomUUID: () => "test-request" },
    TextEncoder,
    Date,
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return { elements, events, document, pending, calls, timers };
}
async function settle(h, data) {
  assert.ok(h.pending.length, "Expected a pending API call");
  h.pending.shift().resolve(response(data));
  await tick();
}
async function start(s = status()) {
  const h = harness();
  await tick();
  await settle(h, s);
  if (s.clientAccess) await settle(h, { clients: [] });
  if (s.oauthAccess) await settle(h, { grants: [] });
  return h;
}
const submit = (h, id) => h.elements[id].onsubmit({ preventDefault() {} });
async function issue(h) {
  h.elements["client-consent"].checked = true;
  submit(h, "client-form");
  await settle(h, {
    id: "test-grant",
    token: "SECRET-TEST-TOKEN",
    expiresAt: Date.now() + 300000,
    resource: "https://example.test/openrouter",
  });
  await settle(h, status());
  await settle(h, {
    clients: [
      {
        id: "test-grant",
        clientId: "dots",
        scopes: ["models:read"],
        expiresAt: Date.now() + 300000,
      },
    ],
  });
}
{
  const h = await start(
    status({ mode: "demo-tone", liveTrial: false, clientAccess: false }),
  );
  assert.ok(h.elements.key.disabled);
  assert.ok(h.elements["save-key"].disabled);
  h.elements.key.value = "synthetic-key";
  h.elements.consent.checked = true;
  submit(h, "keys");
  assert.equal(h.calls.length, 1);
  assert.equal(h.elements.key.value, "");
  assert.equal(h.elements.consent.checked, false);
}
{
  const h = await start(status({ mode: "demo-tone" }));
  assert.equal(
    h.elements.key.disabled,
    false,
    "Production disabled-provider mode can save keys",
  );
  assert.equal(h.elements.budget.max, "0.10");
  assert.ok(h.elements.approval.disabled);
  assert.ok(h.elements.retention.disabled);
  h.elements.key.value = "synthetic";
  submit(h, "keys");
  assert.equal(h.calls.length, 2);
  assert.equal(h.elements.key.value, "");
  h.elements.key.value = "synthetic";
  h.elements.consent.checked = true;
  submit(h, "keys");
  submit(h, "keys");
  assert.equal(h.calls.length, 3);
  assert.equal(h.elements.key.value, "");
  assert.equal(h.elements.consent.checked, false);
  h.pending.shift().reject(Error("synthetic failure"));
  await tick();
  assert.equal(h.elements.key.value, "");
  assert.equal(h.elements.consent.checked, false);
  assert.equal(h.elements.key.disabled, false);
  h.elements.text.value = "😀".repeat(76);
  submit(h, "speech");
  await tick();
  assert.match(h.elements.notice.textContent, /Live provider disabled/);
  assert.equal(h.calls.length, 3);
}
{
  const h = await start();
  h.elements.text.value = "😀".repeat(76);
  submit(h, "speech");
  await tick();
  assert.match(h.elements.notice.textContent, /300 UTF-8/);
  submit(h, "client-form");
  assert.equal(h.calls.length, 2);
  await issue(h);
  assert.deepEqual(JSON.parse(h.calls[2].init.body), {
    clientId: "dots",
    scopes: ["models:read"],
    consent: true,
  });
  assert.equal(h.elements["client-token"].type, "password");
  h.elements["reveal-token"].onclick();
  assert.equal(h.elements["client-token"].type, "text");
  h.elements.clients.children[0].children[1].onclick();
  assert.equal(h.elements["client-token"].value, "");
  await settle(h, { ok: true });
  await settle(h, status());
  await settle(h, { clients: [] });
  assert.equal(h.elements["client-token"].value, "");
}
for (const event of [
  "pagehide",
  "beforeunload",
  "popstate",
  "visibilitychange",
]) {
  const h = await start();
  h.elements["client-consent"].checked = true;
  submit(h, "client-form");
  submit(h, "client-form");
  assert.equal(h.calls.length, 3);
  if (event === "visibilitychange") h.document.hidden = true;
  h.events[event]();
  await settle(h, { token: "STALE-SECRET", expiresAt: Date.now() + 300000 });
  assert.equal(h.elements["client-token"].value, "");
  assert.equal(h.pending.length, 0);
}
{
  const h = await start();
  await issue(h);
  for (const fn of [...h.timers.values()]) fn();
  assert.equal(h.elements["client-token"].value, "");
  assert.ok(h.elements.issued.hidden);
  await issue(h);
  h.document.hidden = true;
  h.events.visibilitychange();
  assert.equal(h.elements["client-token"].value, "");
}
{
  const h = await start();
  h.elements.budget.value = "0.03";
  h.elements.policy.oninput();
  h.elements.text.value = "Keep my unsaved text";
  h.elements["scope-audio"].checked = true;
  h.elements.refresh.onclick();
  await tick();
  await settle(h, status());
  await settle(h, { clients: [] });
  assert.equal(h.elements.budget.value, "0.03");
  assert.equal(h.elements.text.value, "Keep my unsaved text");
  assert.ok(h.elements["scope-audio"].checked);
}
assert.doesNotMatch(script, /localStorage|sessionStorage|clipboard|console\./);

// Discard during issuance invalidates the late secret without changing server grant state.
{
  const h = await start();
  h.elements["client-consent"].checked = true;
  submit(h, "client-form");
  h.elements["hide-token"].onclick();
  await settle(h, { token: "STALE-SECRET", expiresAt: Date.now() + 300000 });
  await settle(h, status());
  await settle(h, { clients: [] });
  assert.equal(h.elements["client-token"].value, "");
}
// Editing a policy while its save is in flight must preserve the newer draft.
{
  const h = await start();
  h.elements.budget.value = "0.04";
  h.elements.policy.oninput();
  submit(h, "policy");
  h.elements.budget.value = "0.03";
  h.elements.policy.oninput();
  await settle(h, { ok: true });
  await settle(h, status());
  await settle(h, { clients: [] });
  assert.equal(h.elements.budget.value, "0.03");
}

{
  const config = status({
    clientAccess: false,
    oauthAccess: true,
    oauthResource: "https://mcp.vocs.io/openrouter",
  });
  const h = await start(config);
  assert.equal(h.elements["clients-section"].hidden, true);
  assert.equal(h.elements["oauth-section"].hidden, false);
  assert.equal(h.elements["oauth-resource"].textContent, config.oauthResource);
  h.elements.refresh.onclick();
  await tick();
  await settle(h, config);
  const grant = {
    id: "oauth-grant",
    clientId: "<img src=x>",
    scopes: ["models:read"],
    expiresAt: Date.now() + 60000,
    revokedAt: null,
  };
  await settle(h, { grants: [grant] });
  assert.ok(
    h.elements["oauth-grants"].children[0].children[0].textContent.includes(
      "<img src=x>",
    ),
  );
  const revoke = h.elements["oauth-grants"].children[0].children[1].onclick;
  revoke();
  revoke();
  assert.equal(
    h.calls.filter((c) => c.url === "/api/oauth/grants/oauth-grant").length,
    1,
  );
  await settle(h, { revoked: true });
  await settle(h, config);
  await settle(h, { grants: [{ ...grant, revokedAt: Date.now() }] });
  assert.equal(h.elements["oauth-grants"].children[0].children.length, 1);
  h.elements.refresh.onclick();
  await tick();
  await settle(h, config);
  h.document.hidden = true;
  h.events.visibilitychange();
  await settle(h, { grants: [grant] });
  assert.equal(
    h.elements["oauth-grants"].children[0].children.length,
    1,
    "Stale OAuth list cannot restore active controls",
  );
}

console.log(
  "Dashboard fixture checks passed: key consent, production locks, repeated requests, errors, manual and OAuth revocation, hidden/navigation stale responses, token expiry, and unsaved edits.",
);
