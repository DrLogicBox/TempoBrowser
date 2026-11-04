const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'TempoBrowser-win32-x64');
const app = path.join(runtime, 'resources/app');
if (!fs.existsSync(path.join(runtime, 'TempoBrowser.exe'))) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('请在 Windows x64 环境准备运行时');
  }
  const electronPackage = path.join(root, 'node_modules/electron');
  if (!fs.existsSync(path.join(electronPackage, 'package.json'))) {
    throw new Error('请先在当前项目目录运行 npm ci');
  }
  const electronDist = path.join(electronPackage, 'dist');
  if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
    const temporary = path.join(root, '.cache/tmp');
    fs.mkdirSync(temporary, { recursive: true });
    const install = spawnSync(process.execPath, [path.join(electronPackage, 'install.js')], {
      cwd: root,
      env: { ...process.env, TEMP: temporary, TMP: temporary,
        electron_config_cache: path.join(root, '.cache/electron'), ELECTRON_CACHE: path.join(root, '.cache/electron') },
      stdio: 'inherit'
    });
    if (install.error) throw install.error;
    if (install.status !== 0) throw new Error('Electron 官方运行时下载失败，请重试构建');
  }
  fs.cpSync(electronDist, runtime, { recursive: true });
  fs.renameSync(path.join(runtime, 'electron.exe'), path.join(runtime, 'TempoBrowser.exe'));
  if (fs.existsSync(path.join(runtime, 'LICENSE'))) {
    fs.renameSync(path.join(runtime, 'LICENSE'), path.join(runtime, 'LICENSE.electron.txt'));
  }
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(runtime, 'LICENSE'));
}
fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(app, 'src'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(app, 'package.json'));
if (fs.existsSync(path.join(root, 'README.md'))) {
  fs.copyFileSync(path.join(root, 'README.md'), path.join(runtime, 'README.md'));
}
for (const directory of ['assets', 'docs']) {
  if (fs.existsSync(path.join(root, directory))) fs.cpSync(path.join(root, directory), path.join(runtime, directory), { recursive: true });
}
const metadata = {
  appVersion: require('../package.json').version,
  release: 'beta-1',
  electron: fs.readFileSync(path.join(runtime, 'version'), 'utf8').trim(),
  platform: 'win32', arch: 'x64', builtAt: new Date().toISOString(),
  source: fs.readdirSync(path.join(root, 'src')).map(filename => ({
    filename,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src', filename))).digest('hex')
  }))
};
fs.writeFileSync(path.join(runtime, 'BUILD.json'), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ runtime, version: metadata.appVersion }));
