import { privateRateLimit } from "./rate-limit";
import { betterAuth, type BetterAuthOptions } from "better-auth";

export interface AuthEnv {
  AUTH_ENABLED?: string;
  AUTH_ORIGIN?: string;
  AUTH_SECRET?: string;
  AUTH_DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export async function admitted(
  db: D1Database,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT email FROM hub_invitation WHERE email = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    )
    .bind(email.toLowerCase(), Date.now())
    .first();
  return !!row;
}

// Identity tokens are needed only during the OAuth exchange, never after login.
const clearedTokens = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
};

export function authOptions(env: AuthEnv): BetterAuthOptions {
  if (
    !env.AUTH_DB ||
    !env.AUTH_SECRET ||
    env.AUTH_SECRET.length < 32 ||
    !env.AUTH_ORIGIN
  )
    throw new Error("Auth is not configured");
  const origin = new URL(env.AUTH_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.AUTH_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error("Auth requires an exact HTTPS origin");
  const db = env.AUTH_DB;
  return {
    appName: "Vocs account",
    baseURL: origin.origin,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    database: db,
    trustedOrigins: [origin.origin],
    logger: { disabled: true },
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              disableIdTokenSignIn: true,
            },
          }
        : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
    },
    account: {
      accountLinking: { enabled: false, disableImplicitLinking: true },
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      storeAccountCookie: false,
    },
    session: {
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
      freshAge: 5 * 60,
      cookieCache: { enabled: false },
    },
    user: {
      validateUserInfo: async ({ user, source }) => {
        if (
          source.method !== "oauth" ||
          !["google", "github"].includes(source.oauth?.providerId ?? "") ||
          user.emailVerified !== true ||
          typeof user.email !== "string" ||
          !(await admitted(db, user.email))
        )
          return { error: "access_denied" };
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      customStorage: privateRateLimit(db, env.AUTH_SECRET),
      window: 60,
      max: 30,
    },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: "vocs",
      cookies: {
        session_token: { name: "__Host-vocs.session_token" },
        state: { name: "__Host-vocs.state" },
        oauth_state: { name: "__Host-vocs.oauth_state" },
      },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
      crossSubDomainCookies: { enabled: false },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!user.emailVerified || !(await admitted(db, user.email)))
              return false;
            return { data: { ...user, image: null } };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db
              .prepare("SELECT email, emailVerified FROM user WHERE id = ?")
              .bind(session.userId)
              .first<{ email: string; emailVerified: number }>();
            if (!user?.emailVerified || !(await admitted(db, user.email)))
              return false;
            return { data: { ...session, ipAddress: null, userAgent: null } };
          },
        },
      },
      account: {
        create: {
          before: async (account) => ({
            data: { ...account, ...clearedTokens },
          }),
        },
        update: {
          before: async (account) => ({
            data: { ...account, ...clearedTokens },
          }),
        },
      },
    },
  };
}
export const createAuth = (env: AuthEnv) => betterAuth(authOptions(env));
