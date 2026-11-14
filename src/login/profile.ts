/** Deployment-selected, finite identity realms. Never accept issuer/client overrides
 * from requests, browser state, or arbitrary environment URLs.
 */
export const PRODUCTION_LOGIN = Object.freeze({
  name: "production",
  origin: "https://mcp.vocs.io",
  issuer: "https://auth.vocs.io",
  clientId: "mcp-hub",
} as const);
export const STAGING_LOGIN = Object.freeze({
  name: "staging",
  origin: "https://vocs-mcp-staging.vocs.workers.dev",
  issuer: "https://vocs-login-staging.vocs.workers.dev",
  clientId: "mcp-hub-staging",
} as const);
export type LoginProfile = typeof PRODUCTION_LOGIN | typeof STAGING_LOGIN;
export interface LoginProfileEnv {
  LOGIN_PROFILE?: string;
  PUBLIC_ORIGIN?: string;
}
export function selectLoginProfile(env: LoginProfileEnv): LoginProfile | null {
  const profile =
    env.LOGIN_PROFILE === undefined || env.LOGIN_PROFILE === "production"
      ? PRODUCTION_LOGIN
      : env.LOGIN_PROFILE === "staging"
        ? STAGING_LOGIN
        : null;
  return profile && env.PUBLIC_ORIGIN === profile.origin ? profile : null;
}
/** Staging never advertises or accepts an execution/audio capability. */
export function capabilityScopes(profile: LoginProfile): string[] {
  return profile.name === "staging"
    ? ["models:read"]
    : ["models:read", "speech:write", "audio:read"];
}
