const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const token = (n) => { const m = new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css); assert.ok(m, `token --${n}`); return m[1]; };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("text and buttons meet WCAG AA contrast (4.5:1); form borders meet 3:1", () => {
  const pairs = [["ink", "cream"], ["ink", "paper"], ["muted", "cream"], ["muted", "paper"], ["muted", "chip"], ["muted", "soft"], ["accent", "cream"], ["accent", "paper"], ["accent", "accent-soft"], ["warn", "warn-bg"], ["bad", "paper"], ["bad", "bad-bg"]];
  for (const [fg, bg] of pairs) assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}: ${ratio(token(fg), token(bg)).toFixed(2)}`);
  assert.ok(ratio("#ffffff", token("accent")) >= 4.5 && ratio("#ffffff", token("accent-dark")) >= 4.5, "white text on buttons");
  for (const bg of ["cream", "paper", "soft"]) assert.ok(ratio(token("field"), token(bg)) >= 3, `form border on ${bg}`);
});

test("light theme only, cream page, no outside fonts or libraries, phone-friendly basics", () => {
  assert.match(css, /color-scheme: light/); assert.doesNotMatch(css, /prefers-color-scheme: dark/);
  assert.equal(token("cream").toLowerCase(), "#faf6ee"); assert.match(css, /body \{[^}]*background: var\(--cream\)/);
  assert.doesNotMatch(css, /@import|url\(https?:|fonts\.googleapis|@font-face/);
  assert.match(css, /\.tabbar \{[^}]*env\(safe-area-inset-bottom\)/); assert.match(css, /@media print/); assert.match(css, /:focus-visible/);
  assert.match(css, /input\[type=number\][^{]*\{[^}]*font: 400 1rem/, "16px field text so iPhones do not zoom");
});

test("app icon, home-screen icon and manifest exist; the menu is only drawn after sign-in", () => {
  for (const f of ["src/app/icon.svg", "src/app/apple-icon.png", "src/app/manifest.ts"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  const png = fs.readFileSync(path.join(root, "src/app/apple-icon.png")); assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180); assert.ok(png.length < 50_000);
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /owner \? <Nav \/> : null/); assert.match(layout, /themeColor: "#faf6ee"/);
  const manifest = fs.readFileSync(path.join(root, "src/app/manifest.ts"), "utf8"); assert.doesNotMatch(manifest, /DATABASE|SECRET|TOKEN/);
});
