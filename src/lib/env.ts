/** Problems with the server's settings, as plain sentences. Never includes a value. Pure. */
export function envProblems(env: Record<string, string | undefined>, production: boolean): string[] {
  const out: string[] = [];
  const has = (k: string) => (env[k] ?? "").trim() !== "";
  if (!has("DATABASE_URL")) out.push("DATABASE_URL is not set.");
  if (!has("GITHUB_ID") || !has("GITHUB_SECRET")) out.push("GITHUB_ID or GITHUB_SECRET is not set, so nobody can sign in.");
  if (!has("NEXTAUTH_SECRET")) out.push("NEXTAUTH_SECRET is not set.");
  else if ((env.NEXTAUTH_SECRET ?? "").length < 32) out.push("NEXTAUTH_SECRET is shorter than 32 characters.");
  if (!/^\d+$/.test((env.OWNER_GITHUB_ID ?? "").trim())) out.push("OWNER_GITHUB_ID must be your numeric GitHub ID, so nobody can sign in until it is.");
  if (production) {
    if (!has("NEXTAUTH_URL")) out.push("NEXTAUTH_URL is not set.");
    else if (!/^https:\/\//.test((env.NEXTAUTH_URL ?? "").trim())) out.push("NEXTAUTH_URL must start with https://.");
    if (has("ADMIN_DEV_BYPASS")) out.push("ADMIN_DEV_BYPASS is set in production. It is ignored there, but remove it.");
  }
  return out;
}
