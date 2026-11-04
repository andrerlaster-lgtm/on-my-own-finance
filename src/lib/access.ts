/**
 * Pure access rules: who may sign in, and what role they get. No I/O, no secrets in messages.
 * Exactly two accounts exist:
 *  - admin: the GitHub user whose numeric ID equals OWNER_GITHUB_ID.
 *  - business_owner: the Google account whose email equals BUSINESS_OWNER_GOOGLE_EMAIL, and only when Google says it is verified.
 * Roles are never read from the browser. They are recomputed from the signed identity and the current server settings on every request.
 */

export type Role = "admin" | "business_owner";

export interface AccessConfig {
  adminGithubId: string | null;
  ownerGoogleEmail: string | null;
}

/** What we keep in the signed session cookie. Facts about the account, never a role. */
export type Identity =
  | { provider: "github"; githubId: string }
  | { provider: "google"; email: string; emailVerified: boolean };

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function accessConfig(env: Record<string, string | undefined>): AccessConfig {
  const id = (env.OWNER_GITHUB_ID ?? "").trim();
  return { adminGithubId: /^\d+$/.test(id) ? id : null, ownerGoogleEmail: normalizeEmail(env.BUSINESS_OWNER_GOOGLE_EMAIL) };
}

/** Role for an identity under the given settings, or null if the account is not one of the two approved ones. */
export function roleFor(identity: Identity | null | undefined, cfg: AccessConfig): Role | null {
  if (!identity) return null;
  if (identity.provider === "github") {
    return cfg.adminGithubId && /^\d+$/.test(identity.githubId) && identity.githubId === cfg.adminGithubId ? "admin" : null;
  }
  if (identity.provider === "google") {
    const email = normalizeEmail(identity.email);
    return cfg.ownerGoogleEmail && identity.emailVerified === true && email !== null && email === cfg.ownerGoogleEmail ? "business_owner" : null;
  }
  return null;
}

/** Builds an Identity from the provider's sign-in data, or null if it is unusable. Google must say email_verified === true. */
export function identityFromSignIn(provider: string | undefined, profile: unknown): Identity | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as { id?: number | string; email?: unknown; email_verified?: unknown };
  if (provider === "github") return p.id === undefined || p.id === null ? null : { provider: "github", githubId: String(p.id) };
  if (provider === "google") {
    const email = normalizeEmail(p.email);
    return email ? { provider: "google", email, emailVerified: p.email_verified === true } : null;
  }
  return null;
}

/** Rebuilds an Identity from the signed token's fields. Anything malformed gives null (so no access). */
export function identityFromToken(t: Record<string, unknown> | null | undefined): Identity | null {
  if (!t) return null;
  if (t.provider === "github" && typeof t.githubId === "string") return { provider: "github", githubId: t.githubId };
  if (t.provider === "google" && typeof t.googleEmail === "string") return { provider: "google", email: t.googleEmail, emailVerified: t.googleVerified === true };
  return null;
}

export function canManageSecurity(role: Role | null | undefined): boolean {
  return role === "admin";
}
