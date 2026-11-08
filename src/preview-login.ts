import preview from "./preview";
import { handleLogin, cleanupLogin, type LoginEnv } from "./login/worker";
export default {
  async fetch(request: Request, env: LoginEnv): Promise<Response> {
    const login = await handleLogin(request, env);
    if (login) return login;
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
  },
  async scheduled(_event: ScheduledController, env: LoginEnv): Promise<void> {
    await cleanupLogin(env);
  },
} satisfies ExportedHandler<LoginEnv>;
