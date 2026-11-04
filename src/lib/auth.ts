import type { AuthOptions } from "next-auth";
import { getServerSession } from "next-auth/next";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { accessConfig, canManageSecurity, identityFromSignIn, identityFromToken, roleFor, type Role } from "./access";
import { redirect } from "next/navigation";
import { audit, databaseConfigured } from "./db";

/**
 * Access rules for On My Own Finance.
 *  - Exactly two accounts may sign in: the administrator (GitHub user whose numeric ID equals OWNER_GITHUB_ID) and the
 *    business owner (Google account equal to BUSINESS_OWNER_GOOGLE_EMAIL, with a verified email). See access.ts.
 *  - Roles (admin, business_owner) are computed on the server from the signed identity; the browser never supplies one.
 *  - requireOwner()/ownerOrNull() mean "either approved user" (shared business data). requireAdmin() is administrator-only.
 *  - Every page, action and API route calls requireOwner() or ownerOrNull(); nothing is open by default
 *    (tests/auth.test.cjs fails if a page or route is added without one).
 *  - The identity is re-checked on every request, so changing OWNER_GITHUB_ID or BUSINESS_OWNER_GOOGLE_EMAIL revokes old sessions.
 *  - Local dev bypass works only outside production builds (see devBypassActive).
 */

export interface Owner {
  name: string;
  role: Role;
  via: "github" | "google" | "dev-bypass";
}

export function allowedGithubId(): string | null {
  const id = (process.env.OWNER_GITHUB_ID || "").trim();
  return /^\d+$/.test(id) ? id : null;
}

export function githubSignInConfigured(): boolean {
  return Boolean(process.env.GITHUB_ID && process.env.GITHUB_SECRET && process.env.NEXTAUTH_SECRET && allowedGithubId());
}

export function googleSignInConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.NEXTAUTH_SECRET && accessConfig(process.env).ownerGoogleEmail);
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
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours, then sign in again
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async signIn({ account, profile }) {
      const ok = roleFor(identityFromSignIn(account?.provider, profile), accessConfig(process.env)) !== null;
      // Record the outcome only (no account names, IDs or emails). Logging must never block or break sign-in.
      try { if (databaseConfigured()) await audit(ok ? "signin_allowed" : "signin_refused"); } catch { /* ignore */ }
      return ok;
    },
    async jwt({ token, account, profile }) {
      if (account) {
        // A fresh sign-in replaces any earlier identity. Only facts are stored; the role is derived later.
        delete token.provider; delete token.githubId; delete token.googleEmail; delete token.googleVerified;
        const id = identityFromSignIn(account.provider, profile);
        if (id?.provider === "github") { token.provider = "github"; token.githubId = id.githubId; }
        if (id?.provider === "google") { token.provider = "google"; token.googleEmail = id.email; token.googleVerified = id.emailVerified; }
      }
      return token;
    },
    async session({ session, token }) {
      // Role is recomputed from the signed token and the CURRENT server settings on every request (so revoking access takes effect at once).
      const role = roleFor(identityFromToken(token as Record<string, unknown>), accessConfig(process.env));
      (session as { role?: Role | null }).role = role;
      (session as { via?: "github" | "google" }).via = token.provider === "google" ? "google" : "github";
      return session;
    },
  },
};

/** The signed-in approved user, or null. Never trusts anything sent by the browser except the signed session. */
export async function ownerOrNull(): Promise<Owner | null> {
  if (devBypassActive()) return { name: "Local developer", role: "admin", via: "dev-bypass" };
  const session = (await getServerSession(authOptions)) as { role?: Role | null; via?: "github" | "google"; user?: { name?: string | null } } | null;
  if (!session || (session.role !== "admin" && session.role !== "business_owner")) return null;
  return { name: session.user?.name || (session.role === "admin" ? "Administrator" : "Business owner"), role: session.role, via: session.via === "google" ? "google" : "github" };
}

/** Call at the top of every private page and server action. Sends anyone else to the sign-in screen. */
export async function requireOwner(): Promise<Owner> {
  const owner = await ownerOrNull();
  if (!owner) redirect("/signin");
  return owner;
}

/** Administrator-only (security and permission management). The business owner is sent home. */
export async function requireAdmin(): Promise<Owner> {
  const owner = await requireOwner();
  if (!canManageSecurity(owner.role)) redirect("/");
  return owner;
}
