/**
 * Guarded string rewriting for HTML derived from another HTML string (the public
 * mock from its frozen template, staging copy from production pages).
 *
 * A plain `.replace()` that matches nothing fails silently, and a derived public page
 * would then ship the private copy or controls it was meant to remove. Every edit here
 * must match exactly once (or at least once for "all"), otherwise this throws while the
 * module loads, so tests, check scripts and Worker start-up all fail loudly.
 *
 * Kept free of runtime imports: Node loads it directly in scripts/check-*.mjs.
 */
export type Edit =
  | readonly [from: string | RegExp, to: string]
  | readonly [from: string, to: string, mode: "all"];

function count(source: string, from: string | RegExp): number {
  if (typeof from === "string") return source.split(from).length - 1;
  const flags = from.flags.includes("g") ? from.flags : from.flags + "g";
  return [...source.matchAll(new RegExp(from.source, flags))].length;
}

export function rewrite(source: string, edits: readonly Edit[]): string {
  let out = source;
  for (const [from, to, mode] of edits) {
    const found = count(out, from);
    if (mode === "all" ? found < 1 : found !== 1)
      throw new Error(
        `rewrite: expected ${mode === "all" ? "at least one match" : "exactly one match"} for ${String(from).slice(0, 80)}, found ${found}`,
      );
    // A replacer function keeps "$" sequences in the replacement literal.
    out =
      mode === "all"
        ? out.replaceAll(from as string, () => to)
        : out.replace(from, () => to);
  }
  return out;
}
