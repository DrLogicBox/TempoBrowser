const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const before = JSON.parse(fs.readFileSync(path.join(root, 'evidence/protected-before.json'), 'utf8'));
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(filename);
    return [{ path: path.relative(before.directory, filename), size: fs.statSync(filename).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') }];
  });
}
const after = walk(before.directory);
const old = new Map(before.files.map(file => [file.path, file]));
const current = new Map(after.map(file => [file.path, file]));
const changed = before.files.filter(file => !current.has(file.path) || current.get(file.path).sha256 !== file.sha256).map(file => file.path);
const added = after.filter(file => !old.has(file.path)).map(file => file.path);
const report = { directory: before.directory, checkedAt: new Date().toISOString(), filesBefore: before.files.length,
  filesAfter: after.length, changed, added, unchanged: changed.length === 0 && added.length === 0 };
fs.writeFileSync(path.join(root, 'evidence/protected-after.json'), JSON.stringify({ ...report, files: after }, null, 2));
fs.writeFileSync(path.join(root, 'evidence/protected-integrity.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.unchanged) process.exitCode = 1;
