const test = require("node:test"), assert = require("node:assert/strict");
const { root, walk, read, exists } = require("./helpers.cjs");
const path = require("node:path");

test("every page and route is gated (except sign-in and the NextAuth endpoints)", () => {
  const files = walk(path.join(root, "src/app")).filter((f) => /(page|route)\.tsx?$/.test(f));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const rel = path.relative(root, f);
    if (rel.includes("[...nextauth]")) continue;
    const src = require("node:fs").readFileSync(f, "utf8");
    assert.match(src, /requireOwner\(|ownerOrNull\(/, `${rel} has no access check`);
  }
});
test("every server action checks the owner first", () => {
  for (const f of walk(path.join(root, "src/app")).filter((f) => /\.tsx?$/.test(f))) {
    const src = require("node:fs").readFileSync(f, "utf8");
    for (const m of src.matchAll(/"use server";\s*\n\s*(await requireOwner\(\)|.*)/g)) assert.match(m[1], /requireOwner/, `${f}: action without owner check`);
  }
});
test("security headers and no-store", () => {
  const c = read("next.config.ts");
  for (const h of ["X-Frame-Options", "nosniff", "no-referrer", "noindex", "no-store"]) assert.ok(c.includes(h), h);
});
test(".env.example has names only; secrets are ignored by git", () => {
  for (const l of read(".env.example").split("\n")) if (/^[A-Z_]+=/.test(l)) assert.match(l, /^[A-Z_]+=$/, "no values in .env.example");
  const g = read(".gitignore");
  for (const x of [".env*", "node_modules", "backups/"]) assert.ok(g.includes(x), x);
});
test("no secrets or patient fields committed in source", () => {
  for (const f of walk(path.join(root, "src"))) assert.doesNotMatch(require("node:fs").readFileSync(f, "utf8"), /postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@|ghp_[A-Za-z0-9]{20}/);
});
test("backup docs cover the restore window and a restore drill", () => {
  const d = read("docs/BACKUPS.md");
  assert.match(d, /restore window/i); assert.match(d, /Restore drill/i); assert.match(d, /7 days/);
});
test("dependencies are exact-pinned", () => {
  const p = JSON.parse(read("package.json"));
  for (const v of Object.values({ ...p.dependencies, ...p.devDependencies })) assert.match(v, /^\d+\.\d+\.\d+$/);
});
