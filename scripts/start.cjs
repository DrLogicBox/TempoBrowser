const { spawn } = require('node:child_process');
const path = require('node:path');
const runtime = path.resolve(__dirname, '../TempoBrowser-win32-x64');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(runtime, 'TempoBrowser.exe'), [], { cwd: runtime, env: environment, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
