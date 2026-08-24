import { oauthAccounts, users, type Db, type User } from "@driftline/db";
import { and, eq } from "drizzle-orm";

import { HttpError } from "../../../lib/errors.js";

interface GithubOAuthEnv {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SERVER_PUBLIC_URL: string;
}

function redirectUri(env: GithubOAuthEnv): string {
  return `${env.SERVER_PUBLIC_URL}/auth/oauth/github/callback`;
}

export function buildAuthorizeUrl(state: string, env: GithubOAuthEnv): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(env));
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(code: string, env: GithubOAuthEnv): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(env),
    }),
  });
  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    throw new HttpError(401, data.error_description ?? "GitHub OAuth exchange failed");
  }
  return data.access_token;
}

interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function githubApiGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "driftline",
    },
  });
  if (!response.ok) {
    throw new HttpError(401, "Failed to fetch GitHub profile");
  }
  return response.json() as Promise<T>;
}

/**
 * Only a verified email can be trusted to identify/link an account — an
 * unverified address on GitHub could belong to someone else.
 */
export function pickPrimaryVerifiedEmail(emails: GithubEmail[]): string | null {
  const verified = emails.filter((candidate) => candidate.verified);
  if (verified.length === 0) {
    return null;
  }
  const primary = verified.find((candidate) => candidate.primary);
  return (primary ?? verified[0]!).email;
}

export interface GithubIdentity {
  providerAccountId: string;
  displayName: string;
  avatarUrl: string | null;
  email: string;
}

export async function fetchGithubIdentity(accessToken: string): Promise<GithubIdentity> {
  const [profile, emails] = await Promise.all([
    githubApiGet<GithubProfile>("/user", accessToken),
    githubApiGet<GithubEmail[]>("/user/emails", accessToken),
  ]);

  const email = pickPrimaryVerifiedEmail(emails);
  if (!email) {
    throw new HttpError(401, "GitHub account has no verified email");
  }

  return {
    providerAccountId: String(profile.id),
    displayName: profile.name ?? profile.login,
    avatarUrl: profile.avatar_url,
    email,
  };
}

export async function findOrCreateOAuthUser(db: Db, identity: GithubIdentity): Promise<User> {
  const [linked] = await db
    .select({ user: users })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(
      and(eq(oauthAccounts.provider, "github"), eq(oauthAccounts.providerAccountId, identity.providerAccountId)),
    )
    .limit(1);
  if (linked) {
    return linked.user;
  }

  // Not linked yet — reuse an existing account with the same verified email
  // (e.g. registered by password first) rather than creating a duplicate.
  const [existingByEmail] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  let user = existingByEmail;
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
      })
      .returning();
    user = created!;
  }

  await db.insert(oauthAccounts).values({ userId: user.id, provider: "github", providerAccountId: identity.providerAccountId });
  return user;
}
