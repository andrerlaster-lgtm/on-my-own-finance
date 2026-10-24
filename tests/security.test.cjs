const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const C = require("../.testbuild/csp.js"), E = require("../.testbuild/env.js");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("CSP: only nonce'd scripts, no inline script, nothing embeddable, no plugins", () => {
  const p = C.buildCsp("abc123", false);
  assert.match(p, /script-src 'self' 'nonce-abc123' 'strict-dynamic'(;|$)/); assert.doesNotMatch(p.split("; ").find((d) => d.startsWith("script-src")), /unsafe-inline|unsafe-eval/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests", "connect-src 'self'"]) assert.ok(p.includes(d), d);
  assert.doesNotMatch(p, /\*|http:|https:/, "no wildcard or outside sources");
  const dev = C.buildCsp("n", true); assert.match(dev, /unsafe-eval/); assert.doesNotMatch(dev, /upgrade-insecure/);
});

test("the proxy only sets the policy: it skips APIs and static files and makes no access decision", () => {
  const src = rd("src/proxy.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(src, /Content-Security-Policy/); assert.match(src, /\(\?!api\|_next\/static\|_next\/image\|favicon\.ico\)/);
  assert.doesNotMatch(src, /redirect|getServerSession|requireOwner|cookies/, "gating stays in the pages, actions and routes");
  assert.match(rd("src/app/layout.tsx"), /await connection\(\)/, "pages render per request so the nonce applies");
});

test("server settings checks never print values and catch the dangerous cases", () => {
  const good = { DATABASE_URL: "postgres://u:SECRETPW@h/db", GITHUB_ID: "i", GITHUB_SECRET: "s", NEXTAUTH_SECRET: "x".repeat(32), OWNER_GITHUB_ID: "12345", NEXTAUTH_URL: "https://app.example" };
  assert.deepEqual(E.envProblems(good, true), []);
  assert.match(E.envProblems({ ...good, ADMIN_DEV_BYPASS: "1" }, true).join(), /ADMIN_DEV_BYPASS is set in production/);
  assert.deepEqual(E.envProblems({ ...good, ADMIN_DEV_BYPASS: "1" }, false), [], "allowed for local testing");
  assert.match(E.envProblems({ ...good, NEXTAUTH_SECRET: "short" }, true).join(), /shorter than 32/);
  assert.match(E.envProblems({ ...good, OWNER_GITHUB_ID: "andre" }, true).join(), /numeric GitHub ID/);
  assert.match(E.envProblems({ ...good, NEXTAUTH_URL: "http://app.example" }, true).join(), /https/);
  assert.equal(E.envProblems({}, true).length >= 5, true);
  assert.doesNotMatch(E.envProblems({ ...good, NEXTAUTH_SECRET: "SECRETVALUE" }, true).join(), /SECRETVALUE|SECRETPW/, "no values in messages");
});

test("sign-in: only the owner's numeric id, the dev bypass cannot work in production, and only outcomes are logged", () => {
  const a = rd("src/lib/auth.ts");
  assert.match(a, /process\.env\.NODE_ENV !== "production" && process\.env\.ADMIN_DEV_BYPASS === "1"/);
  assert.match(a, /signin_allowed/); assert.match(a, /signin_refused/);
  const cb = a.slice(a.indexOf("async signIn("), a.indexOf("async jwt("));
  assert.doesNotMatch(cb, /audit\([^)]*(profile|id|login|email|name)/i, "the log call carries no account details");
  assert.match(a, /catch \{ \/\* ignore \*\/ \}/, "a logging failure cannot block sign-in");
});

test("incident guide covers the steps that cut off access", () => {
  const d = rd("docs/INCIDENT.md");
  for (const k of [/NEXTAUTH_SECRET/, /GITHUB_SECRET/, /DATABASE_URL/, /Activity/, /npm run backup/]) assert.match(d, k);
});
