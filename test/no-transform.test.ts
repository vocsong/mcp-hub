import { describe, it, expect } from "vitest";
import { withNoTransform } from "../src/no-transform";
import { formActionSource } from "../src/oauth";

describe("Cache-Control no-transform on HTML", () => {
  const html = (cacheControl?: string) =>
    new Response("<!doctype html><title>x</title>", {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
      },
    });

  it("appends no-transform to HTML and keeps the existing directives", () => {
    expect(withNoTransform(html("no-store")).headers.get("Cache-Control")).toBe(
      "no-store, no-transform",
    );
    expect(withNoTransform(html()).headers.get("Cache-Control")).toBe(
      "no-transform",
    );
  });

  it("does not duplicate an existing no-transform", () => {
    expect(
      withNoTransform(html("no-store, No-Transform")).headers.get(
        "Cache-Control",
      ),
    ).toBe("no-store, No-Transform");
  });

  it("leaves JSON and assets exactly as they were", async () => {
    const json = Response.json(
      { ok: true },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
    expect(withNoTransform(json)).toBe(json);
    const font = new Response(new Uint8Array([1, 2]), {
      headers: {
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    expect(withNoTransform(font).headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("keeps status and body", async () => {
    const out = withNoTransform(
      new Response("<p>gone</p>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(out.status).toBe(404);
    expect(await out.text()).toBe("<p>gone</p>");
  });
});

describe("consent form-action source", () => {
  it("uses the exact origin for http and https redirects", () => {
    expect(formActionSource("https://client.example/cb?x=1")).toBe(
      "https://client.example",
    );
    expect(formActionSource("http://127.0.0.1:8123/callback")).toBe(
      "http://127.0.0.1:8123",
    );
  });

  it("uses only the scheme for app redirects, never anything injectable", () => {
    expect(formActionSource("cursor://anysphere.cursor/callback")).toBe(
      "cursor:",
    );
    for (const value of [
      "https://a.example/cb'; script-src *",
      "https://a.example/cb; default-src *",
    ])
      expect(formActionSource(value)).not.toMatch(/[;' ]/);
  });
});
