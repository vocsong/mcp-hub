/**
 * Cloudflare's edge may rewrite HTML in transit — notably to inject the Web Analytics
 * beacon script, which every Content-Security-Policy on this hub blocks (a console
 * error on every page, and a third-party script these pages must never run).
 * `Cache-Control: no-transform` tells the proxy not to modify the payload.
 * Applied to HTML responses only: JSON and asset caching headers stay exactly as set.
 */
export function withNoTransform(response: Response): Response {
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().startsWith("text/html")) return response;
  const current = response.headers.get("Cache-Control");
  if (current && /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(current))
    return response;
  const result = new Response(response.body, response);
  result.headers.set(
    "Cache-Control",
    current ? `${current}, no-transform` : "no-transform",
  );
  return result;
}
