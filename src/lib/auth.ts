import type { AuthOptions } from "next-auth";
import { getServerSession } from "next-auth/next";
import GitHubProvider from "next-auth/providers/github";
import { redirect } from "next/navigation";
import { audit, databaseConfigured } from "./db";

/**
 * Access rules for On My Own Finance.
 *  - Exactly one account may sign in: the GitHub user whose numeric ID equals OWNER_GITHUB_ID.
 *  - Every page, action and API route calls requireOwner() or ownerOrNull(); nothing is open by default
 *    (tests/auth.test.cjs fails if a page or route is added without one).
 *  - The ID is re-checked on every request, so changing OWNER_GITHUB_ID revokes old sessions.
 *  - Local dev bypass works only outside production builds (see devBypassActive).
 */

export interface Owner {
  name: string;
  githubId: string;
  via: "github" | "dev-bypass";
}

export function allowedGithubId(): string | null {
  const id = (process.env.OWNER_GITHUB_ID || "").trim();
  return /^\d+$/.test(id) ? id : null;
}

export function githubSignInConfigured(): boolean {
  return Boolean(process.env.GITHUB_ID && process.env.GITHUB_SECRET && process.env.NEXTAUTH_SECRET && allowedGithubId());
}

/** True only in `next dev` with ADMIN_DEV_BYPASS=1. `next build` / Vercel always run as production. */
export function devBypassActive(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_DEV_BYPASS === "1";
}

export const authOptions: AuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID || "",
      clientSecret: process.env.GITHUB_SECRET || "",
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours, then sign in again
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async signIn({ account, profile }) {
      const allowed = allowedGithubId();
      const ok = Boolean(allowed && account?.provider === "github" && profile && String((profile as { id?: number | string }).id) === allowed);
      // Record the outcome only (no account names or IDs). Logging must never block or break sign-in.
      try { if (databaseConfigured()) await audit(ok ? "signin_allowed" : "signin_refused"); } catch { /* ignore */ }
      return ok;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) token.githubId = String((profile as { id?: number | string }).id);
      return token;
    },
    async session({ session, token }) {
      (session as { githubId?: string }).githubId = typeof token.githubId === "string" ? token.githubId : undefined;
      return session;
    },
  },
};

/** The signed-in owner, or null. Never trusts anything sent by the browser except the signed session. */
export async function ownerOrNull(): Promise<Owner | null> {
  if (devBypassActive()) return { name: "Local developer", githubId: "dev", via: "dev-bypass" };
  const allowed = allowedGithubId();
  if (!allowed) return null;
  const session = await getServerSession(authOptions);
  const id = (session as { githubId?: string } | null)?.githubId;
  if (!session || id !== allowed) return null;
  return { name: session.user?.name || "Owner", githubId: id, via: "github" };
}

/** Call at the top of every private page and server action. Sends anyone else to the sign-in screen. */
export async function requireOwner(): Promise<Owner> {
  const owner = await ownerOrNull();
  if (!owner) redirect("/signin");
  return owner;
}
