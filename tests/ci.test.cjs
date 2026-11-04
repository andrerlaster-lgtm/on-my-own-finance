const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("CI runs the same checks as a contributor, with read-only access and no secrets", () => {
  const y = rd(".github/workflows/ci.yml");
  for (const step of ["npm run typecheck", "npm test", "npm run build", "npm audit --audit-level=high", "npm ci --ignore-scripts"]) assert.ok(y.includes(step), step);
  assert.match(y, /permissions:\s*\n\s*contents: read/); assert.match(y, /persist-credentials: false/);
  assert.doesNotMatch(y, /secrets\.|DATABASE_URL|GITHUB_SECRET|NEXTAUTH/, "no secrets or database access in CI");
  assert.doesNotMatch(y, /pull_request_target/, "untrusted PR code never runs with write access");
});
test("dependabot is limited and covers npm and the workflow actions", () => {
  const d = rd(".github/dependabot.yml");
  assert.match(d, /package-ecosystem: npm/); assert.match(d, /package-ecosystem: github-actions/); assert.match(d, /open-pull-requests-limit: 3/);
});
