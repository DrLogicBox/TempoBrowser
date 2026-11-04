const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { startFixture } = require('./fixture.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'unified-' + new Date().toISOString().replaceAll(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const result = { startedAt: new Date().toISOString(), checks: [], rates: [], screenshots: [] };
const rates = [1, 2, 3, 5, 10, 20];
let app;
let window;
let fixture;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function save() {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
}
function check(name, passed, details) {
  const entry = { name, passed: Boolean(passed), details };
  result.checks.push(entry);
  save();
  console.log(JSON.stringify(entry));
  if (!passed) throw new Error(name);
}
async function waitFor(predicate, timeout = 15000) {
  const start = performance.now();
  let lastError;
  while (performance.now() - start < timeout) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await sleep(80);
  }
  throw lastError || new Error('Wait timed out');
}
const state = () => window.evaluate(() => browser.command('state'));
const page = expression => app.evaluate(({ BrowserWindow }, expression) => {
  const browser = BrowserWindow.getAllWindows()[0];
  const view = browser.contentView.children.find(child => child.webContents && child.webContents !== browser.webContents && child.getVisible());
  return view.webContents.executeJavaScript(expression, true);
}, expression);

async function navigate(url) {
  await window.locator('#address').fill(url);
  await window.locator('#address').press('Enter');
  await waitFor(() => page('typeof measure === "function" && document.querySelector("#video").readyState >= 3'));
}
async function selectRate(rate) {
  const slider = window.locator('#speed');
  await slider.focus();
  await slider.press('Home');
  await waitFor(async () => (await window.locator('#rate').innerText()) === '×1');
  for (let index = 1; index <= rates.indexOf(rate); index += 1) {
    await slider.press('ArrowRight');
    await waitFor(async () => (await window.locator('#rate').innerText()) === '×' + rates[index]);
  }
  if (!await window.locator('#acceleration-enabled').isChecked()) await window.locator('#acceleration-enabled').check();
  await waitFor(() => page(`__tempo.snapshot().enabled && __tempo.snapshot().requested === ${rate}`));
}
async function capture(name) {
  await sleep(300);
  const handle = await app.evaluate(({ BrowserWindow }) => {
    const buffer = BrowserWindow.getAllWindows()[0].getNativeWindowHandle();
    return buffer.length === 8 ? Number(buffer.readBigUInt64LE()) : buffer.readUInt32LE();
  });
  const filename = path.join(output, name + '.png');
  childProcess.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'scripts/capture-window.ps1'), '-WindowHandle', String(handle), '-OutputPath', filename],
  { windowsHide: true, timeout: 20000, env: { ...process.env, TEMP: path.join(root, '.cache/tmp'), TMP: path.join(root, '.cache/tmp') } });
  result.screenshots.push(filename);
}
async function snapshot() {
  return page(`({ ...measure(), duration:document.querySelector('#video').duration })`);
}

async function measureRate(rate) {
  await selectRate(rate);
  await page(`document.querySelector('#video').currentTime=0;document.querySelector('#video').play();addVideo();
    if(!document.querySelector('audio')){const audio=document.createElement('audio');audio.src='/media.webm';audio.muted=true;audio.loop=true;document.body.append(audio)}
    document.querySelector('audio').currentTime=0;document.querySelector('audio').play()`);
  await sleep(500);
  const first = await snapshot();
  const started = performance.now();
  let previous = first;
  const progress = { video: 0, dynamic: 0, audio: 0 };
  while (performance.now() - started < 10000) {
    await sleep(120);
    const current = await snapshot();
    for (const key of Object.keys(progress)) {
      let delta = current[key] - previous[key];
      if (delta < 0 && Number.isFinite(current.duration)) delta += current.duration;
      if (delta >= 0) progress[key] += delta;
    }
    previous = current;
  }
  const realSeconds = (performance.now() - started) / 1000;
  const effective = Object.fromEntries(Object.entries(progress).map(([name, seconds]) => [name, seconds / realSeconds]));
  for (const key of ['date', 'perf', 'raf', 'css', 'wa']) effective[key] = (previous[key] - first[key]) / 1000 / realSeconds;
  effective.ticks = (previous.ticks - first.ticks) / realSeconds;
  const frameStates = await app.evaluate(async ({ BrowserWindow }) => {
    const browser = BrowserWindow.getAllWindows()[0];
    const view = browser.contentView.children.find(child => child.webContents && child.webContents !== browser.webContents && child.getVisible());
    return Promise.all(view.webContents.mainFrame.framesInSubtree.map(async frame => ({ url: frame.url, snapshot: await frame.executeJavaScript('__tempo.snapshot()') })));
  });
  const row = { selected: rate, realSeconds, effective, actual: previous.tempo.media, frames: frameStates,
    errorsPercent: Object.fromEntries(Object.entries(effective).map(([name, value]) => [name, 100 * (value - rate) / rate])) };
  result.rates.push(row);
  save();
  console.log('RATE ' + JSON.stringify({ selected: rate, realSeconds, effective }));
  check('统一倍率 ×' + rate + ' 页面时钟和动画实测', ['date', 'perf', 'raf', 'css', 'wa'].every(key => Math.abs(effective[key] - rate) / rate < 0.03), effective);
  check('嵌入框架统一配置 ×' + rate, frameStates.length === 3 && frameStates.every(frame => frame.snapshot.enabled && frame.snapshot.effectiveRate === rate));
  if (rate < 20) {
    check('统一倍率 ×' + rate + ' 媒体实际进度', Math.abs(effective.video - rate) / rate < 0.1 &&
      Math.abs(effective.dynamic - rate) / rate < 0.1 && Math.abs(effective.audio - rate) / rate < 0.25 &&
      previous.tempo.media.every(media => media.actual === rate && !media.error), effective);
  } else {
    await waitFor(() => window.locator('#speed-status').innerText().then(text => text.includes('部分生效')));
    check('媒体 ×20 限制被真实反馈', previous.tempo.media.every(media => media.error && media.actual !== 20), previous.tempo.media);
  }
  if (rate === 2 || rate === 20) await capture('unified-x' + rate);
}

async function main() {
  fixture = await startFixture();
  const temporary = path.join(root, '.cache/tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const environment = { ...process.env, TEMP: temporary, TMP: temporary };
  delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: path.join(root, 'TempoBrowser-win32-x64/TempoBrowser.exe'),
    args: ['--profile=test-profile-unified-' + Date.now()], cwd: root, env: environment, colorScheme: null });
  window = await app.firstWindow();
  result.versions = await app.evaluate(() => process.versions);
  await waitFor(() => page('document.title === "新标签页"'));
  check('beta-1 统一开关及模式合并', await window.locator('#acceleration-enabled').count() === 1 && await window.locator('#mode').count() === 0);
  await navigate(fixture.url);
  await selectRate(2);
  check('开启统一加速无预警弹窗', !await window.locator('#confirm-dialog').isVisible());
  for (const rate of rates) await measureRate(rate);

  await selectRate(2);
  await window.locator('#acceleration-enabled').uncheck();
  await waitFor(() => page('__tempo.snapshot().effectiveRate === 1 && __tempo.snapshot().media.every(item=>item.actual===1)'));
  check('关闭开关同时恢复媒体和页面原速', await window.locator('#rate').innerText() === '×2');
  await window.locator('#acceleration-enabled').check();
  await waitFor(() => page('__tempo.snapshot().effectiveRate===2 && __tempo.snapshot().media.every(item=>item.actual===2)'));
  check('重开统一开关恢复保留倍率', true);
  await page('document.querySelector("#video").playbackRate=1;addVideo()');
  await sleep(500);
  check('页面重置倍率与动态播放器替换后继续生效', await page('document.querySelector("#video").playbackRate===2 && document.querySelector("#dynamicVideo").playbackRate===2'));
  await window.locator('#reload').click();
  await waitFor(() => page('typeof measure === "function" && __tempo.snapshot().enabled && __tempo.snapshot().effectiveRate===2'));
  check('刷新保留统一加速设置', true);
  await navigate(fixture.url + '/?navigate=1');
  check('跳转保留统一加速设置', await page('__tempo.snapshot().effectiveRate') === 2);
  await window.locator('#new').click();
  await waitFor(() => page('document.title === "新标签页"'));
  check('新标签默认关闭加速', !await window.locator('#acceleration-enabled').isChecked());
  await window.locator('.tab').first().click();
  check('切换标签显示各自设置', await window.locator('#acceleration-enabled').isChecked() && await window.locator('#rate').innerText() === '×2');
  await window.locator('#reset').click();
  await waitFor(() => page('__tempo.snapshot().effectiveRate===1 && __tempo.snapshot().media.every(item=>item.actual===1)'));
  check('一键恢复所有已控制机制', true);
  await window.locator('#bookmark').click();
  check('书签基础功能', (await state()).bookmarks.some(bookmark => bookmark.url.includes('navigate=1')));
  await page(`document.querySelector('a[href="/download"]').click()`);
  await waitFor(async () => (await state()).downloads.some(download => download.state === 'completed'));
  const download = (await state()).downloads.find(download => download.state === 'completed');
  const bytes = fs.readFileSync(download.path);
  check('实际下载完整文件', bytes.length === 1048576 && bytes.every(value => value === 84));
  await window.locator('#theme').click();
  check('深色主题', await window.locator('body').evaluate(body => body.classList.contains('dark')));
  for (const factor of [1, 1.25, 1.5, 2]) {
    await app.evaluate(({ BrowserWindow }, factor) => { const browser = BrowserWindow.getAllWindows()[0]; browser.setSize(1000, 760); browser.webContents.setZoomFactor(factor); }, factor);
    await sleep(350);
    const rectangles = await window.evaluate(() => {
      const rect = id => { const value = document.getElementById(id).getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right }; };
      return { view: rect('viewport'), toggle: rect('acceleration-enabled'), rate: rect('rate'), width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
    const native = await app.evaluate(({ BrowserWindow }) => { const browser = BrowserWindow.getAllWindows()[0]; return browser.contentView.children.find(child => child.webContents && child.webContents !== browser.webContents && child.getVisible()).getBounds(); });
    check('统一工具区缩放 ' + factor, rectangles.scrollWidth <= rectangles.width + 1 && rectangles.toggle.right < rectangles.rate.x &&
      ['x', 'y', 'width', 'height'].every(key => Math.abs(native[key] - rectangles.view[key] * factor) < 2), { rectangles, native });
  }
  await app.evaluate(({ BrowserWindow }) => { const browser = BrowserWindow.getAllWindows()[0]; browser.setSize(1360, 900); browser.webContents.setZoomFactor(1); });
  await capture('beta1-final');
}

main().catch(error => { result.fatal = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  result.finishedAt = new Date().toISOString();
  save();
  if (app) await app.close().catch(() => {});
  if (fixture) await new Promise(resolve => fixture.server.close(resolve));
  console.log('UNIFIED_RESULT ' + output);
});
