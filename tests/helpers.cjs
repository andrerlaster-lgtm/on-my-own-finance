const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
module.exports = { root, walk, read: (p) => fs.readFileSync(path.join(root, p), "utf8"), exists: (p) => fs.existsSync(path.join(root, p)) };
