const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const status = spawnSync('python', [path.join(__dirname, 'release.py')], {
  cwd: root,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TEMP: path.join(root, '.cache/tmp'), TMP: path.join(root, '.cache/tmp') },
  stdio: 'inherit'
});
if (status.error) throw status.error;
process.exitCode = status.status ?? 1;
