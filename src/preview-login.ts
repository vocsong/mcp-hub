import preview from "./preview";
import { withNoTransform } from "./no-transform";
import { handleLogin, cleanupLogin, type LoginEnv } from "./login/worker";
import { handleAccountCatalog, type CapabilityEnv } from "./authorization";
/** The production preview entry: identity-only login, the static mock, and — only
 * behind NATIVE_CATALOG_ENABLED — the read-only account catalog. Nothing else from
 * the capability/OAuth stack is routed here, whatever APP_MODE or
 * CAPABILITY_AUTH_ENABLED say.
 */
export type PreviewEnv = LoginEnv & CapabilityEnv;
// Every response from the production host is HTTPS-only for a year: this host only,
// since includeSubDomains/preload bind the whole zone. The mock is otherwise unchanged.
const secureResponse = (response: Response) => {
  const result = new Response(response.body, response);
  result.headers.set("Strict-Transport-Security", "max-age=31536000");
  return result;
};
async function route(request: Request, env: PreviewEnv): Promise<Response> {
  const login = await handleLogin(request, env);
  if (login) return login;
  if (env.NATIVE_CATALOG_ENABLED === "true") {
    // Owns exactly /api/connections and its protected-resource metadata; null
    // for every other path, which falls through to the unchanged mock.
    const catalog = await handleAccountCatalog(request, env);
    if (catalog) return catalog;
  }
  const result = preview.fetch(request);
  if (
    new URL(request.url).pathname === "/health" &&
    request.method === "GET" &&
    env.PRODUCT_LOGIN_ENABLED === "true" &&
    env.LOGIN_DB
  ) {
    return Response.json(
      {
        ...((await result.json()) as object),
        serverStorage: true,
        productLogin: "identity-only",
        mcpAuthorized: false,
      },
      result,
    );
  }
  return result;
}
export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    return withNoTransform(secureResponse(await route(request, env)));
  },
  async scheduled(_event: ScheduledController, env: PreviewEnv): Promise<void> {
    await cleanupLogin(env);
  },
} satisfies ExportedHandler<PreviewEnv>;
