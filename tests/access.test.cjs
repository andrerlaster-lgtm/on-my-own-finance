const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const A = require("../.testbuild/access.js");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const cfg = A.accessConfig({ OWNER_GITHUB_ID: "12345", BUSINESS_OWNER_GOOGLE_EMAIL: " Owner@Example.com " });
const gh = (id) => ({ provider: "github", githubId: String(id) });
const goog = (email, v = true) => ({ provider: "google", email, emailVerified: v });

test("authorized users get the right server-side role", () => {
  assert.equal(A.roleFor(gh(12345), cfg), "admin");
  assert.equal(A.roleFor(goog("owner@example.com"), cfg), "business_owner");
  assert.equal(A.roleFor(goog("OWNER@example.COM"), cfg), "business_owner", "email match ignores case");
});

test("unauthorized accounts are refused", () => {
  assert.equal(A.roleFor(gh(999), cfg), null);
  assert.equal(A.roleFor(goog("someone@example.com"), cfg), null);
  assert.equal(A.roleFor(goog("owner@example.com.evil.com"), cfg), null);
  assert.equal(A.roleFor(null, cfg), null);
  assert.equal(A.roleFor({ provider: "facebook" }, cfg), null);
});

test("a Google email that is not verified is refused", () => {
  assert.equal(A.roleFor(goog("owner@example.com", false), cfg), null);
  const id = A.identityFromSignIn("google", { email: "owner@example.com", email_verified: "true" });
  assert.equal(A.roleFor(id, cfg), null, "only boolean true counts");
  assert.equal(A.roleFor(A.identityFromSignIn("google", { email: "owner@example.com" }), cfg), null, "missing flag is not verified");
  assert.equal(A.roleFor(A.identityFromSignIn("google", { email: "owner@example.com", email_verified: true }), cfg), "business_owner");
});

test("providers cannot borrow each other's identity", () => {
  assert.equal(A.roleFor(A.identityFromSignIn("github", { id: 12345, email: "owner@example.com" }), cfg), "admin");
  assert.equal(A.roleFor(A.identityFromSignIn("github", { email: "owner@example.com", email_verified: true }), cfg), null, "GitHub with the owner's email gets nothing");
  assert.equal(A.roleFor(A.identityFromSignIn("google", { id: 12345, email: "x@example.com", email_verified: true }), cfg), null, "Google never matches the GitHub ID");
});

test("missing or malformed settings lock everyone out (fail closed)", () => {
  const none = A.accessConfig({});
  assert.equal(A.roleFor(gh(12345), none), null);
  assert.equal(A.roleFor(goog("owner@example.com"), none), null);
  const bad = A.accessConfig({ OWNER_GITHUB_ID: "andre", BUSINESS_OWNER_GOOGLE_EMAIL: "not-an-email" });
  assert.deepEqual(bad, { adminGithubId: null, ownerGoogleEmail: null });
});

test("role enforcement: only the administrator manages security", () => {
  assert.equal(A.canManageSecurity("admin"), true);
  assert.equal(A.canManageSecurity("business_owner"), false);
  assert.equal(A.canManageSecurity(null), false);
  assert.equal(A.canManageSecurity(undefined), false);
  const act = rd("src/app/activity/page.tsx");
  assert.match(act, /requireAdmin\(\)/); assert.doesNotMatch(act, /requireOwner\(\)/, "Activity (security log) is admin only");
  assert.match(rd("src/lib/auth.ts"), /canManageSecurity\(owner\.role\)/);
});

test("session validation: roles are rebuilt from the signed identity and current settings, never trusted from the token", () => {
  const t = { provider: "google", googleEmail: "owner@example.com", googleVerified: true };
  assert.equal(A.roleFor(A.identityFromToken(t), cfg), "business_owner");
  assert.equal(A.roleFor(A.identityFromToken({ ...t, role: "admin" }), cfg), "business_owner", "a role field in the token is ignored");
  assert.equal(A.roleFor(A.identityFromToken({ ...t, googleVerified: false }), cfg), null);
  assert.equal(A.roleFor(A.identityFromToken({ provider: "github", githubId: "12345" }), cfg), "admin");
  for (const bad of [null, undefined, {}, { provider: "github" }, { provider: "github", githubId: 12345 }, { provider: "google" }, { provider: "other", githubId: "12345" }]) assert.equal(A.roleFor(A.identityFromToken(bad), cfg), null);
  const rotated = A.accessConfig({ OWNER_GITHUB_ID: "12345", BUSINESS_OWNER_GOOGLE_EMAIL: "new@example.com" });
  assert.equal(A.roleFor(A.identityFromToken(t), rotated), null, "changing the approved email revokes the old session");
});

test("auth wiring: both providers, 8-hour sessions, no credentials in source, logs carry no account details", () => {
  const a = rd("src/lib/auth.ts");
  assert.match(a, /GitHubProvider\(/); assert.match(a, /GoogleProvider\(/);
  assert.match(a, /maxAge: 8 \* 60 \* 60/);
  assert.match(a, /process\.env\.GOOGLE_CLIENT_ID/); assert.match(a, /process\.env\.GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(a, /[0-9]{6,}-[a-z0-9]+\.apps\.googleusercontent\.com|GOCSPX-/, "no literal Google credentials");
  assert.doesNotMatch(a, /console\./, "nothing is printed");
  const cb = a.slice(a.indexOf("async signIn("), a.indexOf("async jwt("));
  assert.doesNotMatch(cb, /audit\([^)]*(profile|email|id|login|name)/i);
  assert.match(a, /export async function requireAdmin/);
});

test("sign-in page has separate GitHub and Google buttons", () => {
  const b = rd("src/components/AuthButtons.tsx");
  assert.match(b, /signIn\("github"/); assert.match(b, /signIn\("google"/);
  const p = rd("src/app/signin/page.tsx");
  assert.match(p, /<SignInButton \/>/); assert.match(p, /<GoogleSignInButton \/>/);
});

test(".env.example and setup docs name the new settings without values", () => {
  const e = rd(".env.example");
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "BUSINESS_OWNER_GOOGLE_EMAIL"]) assert.match(e, new RegExp(`^${k}=$`, "m"));
  const d = rd("docs/SETUP.md");
  for (const k of [/api\/auth\/callback\/google/, /BUSINESS_OWNER_GOOGLE_EMAIL/, /GOOGLE_CLIENT_SECRET/]) assert.match(d, k);
});
