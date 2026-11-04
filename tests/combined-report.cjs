const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const { startTimeStudyServer } = require('./time-study/server.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'combined-' + new Date().toISOString().replaceAll(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const result = { startedAt: new Date().toISOString(), rows: [] };
let app;
let shell;
let backend;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
const page = expression => app.evaluate(({ BrowserWindow }, expression) => {
  const browser = BrowserWindow.getAllWindows()[0];
  const view = browser.contentView.children.find(child => child.webContents && child.webContents !== browser.webContents && child.getVisible());
  return view.webContents.executeJavaScript(expression, true);
}, expression);
async function waitFor(predicate) {
  const start = performance.now();
  while (performance.now() - start < 15000) {
    try { if (await predicate()) return; } catch {}
    await sleep(50);
  }
  throw new Error('Combined test timed out');
}
const read = () => page(`({ study:timeStudy.snapshot(), media:{time:document.querySelector('#combined-video').currentTime,
  duration:document.querySelector('#combined-video').duration, actual:document.querySelector('#combined-video').playbackRate,
  paused:document.querySelector('#combined-video').paused} })`);

async function round(rule, repetition) {
  await shell.locator('#address').fill(backend.url + '/?rule=' + rule);
  await shell.locator('#address').press('Enter');
  await waitFor(() => page('Boolean(window.timeStudy) && timeStudy.snapshot().phase === "idle"'));
  await shell.locator('#speed').focus();
  await shell.locator('#speed').press('Home');
  await waitFor(async () => (await shell.locator('#rate').innerText()) === '×1');
  await shell.locator('#speed').press('ArrowRight');
  await waitFor(async () => (await shell.locator('#rate').innerText()) === '×2');
  await page(`const video=document.createElement('video');video.id='combined-video';video.muted=true;video.loop=true;
    video.controls=true;video.style.width='240px';video.src=${JSON.stringify(backend.url + '/media.webm')};
    document.querySelector('.track').before(video);video.play()`);
  await waitFor(() => page('document.querySelector("#combined-video").playbackRate===2 && !document.querySelector("#combined-video").paused'));
  const started = performance.now();
  await page('document.querySelector("#start").click()');
  await waitFor(() => page('timeStudy.snapshot().phase==="running"'));
  let previous = await read();
  let mediaProgress = 0;
  const samples = [];
  while (performance.now() - started < 10000) {
    await sleep(120);
    const current = await read();
    let delta = current.media.time - previous.media.time;
    if (delta < 0 && Number.isFinite(current.media.duration)) delta += current.media.duration;
    if (delta >= 0) mediaProgress += delta;
    samples.push({ driverMs: performance.now() - started, ...current });
    previous = current;
  }
  await page('document.querySelector("#stop").click()');
  const realSeconds = (performance.now() - started) / 1000;
  await waitFor(() => page('timeStudy.snapshot().phase==="finished"'));
  const final = await read();
  const stored = fs.readFileSync(backend.recordsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .find(record => record.runId === final.study.runId && record.event === 'final');
  const request = fs.readFileSync(backend.requestsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .find(record => record.requestId === stored.requestId);
  const wire = JSON.parse(request.rawBody);
  const pageSeconds = final.study.measurements.elapsedPerformanceMs / 1000;
  const mediaRate = mediaProgress / realSeconds;
  const checks = {
    mediaActuallyPlayingAtTwo: !final.media.paused && final.media.actual === 2 && Math.abs(mediaRate - 2) < 0.2,
    pageActuallyAtTwo: Math.abs(pageSeconds - 2 * realSeconds) < 0.3,
    wireMatchesPage: wire.measurements.elapsedPerformanceMs === final.study.measurements.elapsedPerformanceMs,
    savedMatchesWire: stored.clientReportedSeconds === pageSeconds,
    serverNearReal: Math.abs(stored.serverIndependentSeconds - realSeconds) < 0.3,
    adoptedByDeclaredRule: stored.adoptedSeconds === (rule === 'client' ? pageSeconds : stored.serverIndependentSeconds)
  };
  const row = { rule, repetition, realSeconds, pageSeconds, mediaRate, mediaApiRate: final.media.actual,
    wireSeconds: wire.measurements.elapsedPerformanceMs / 1000, backendAdoptedSeconds: stored.adoptedSeconds,
    serverIndependentSeconds: stored.serverIndependentSeconds, samples, final, stored, requestId: stored.requestId,
    checks, passed: Object.values(checks).every(Boolean) };
  result.rows.push(row);
  save();
  console.log(JSON.stringify({ rule, repetition, passed: row.passed, realSeconds, mediaRate, pageSeconds, adopted: stored.adoptedSeconds }));
  if (!row.passed) throw new Error('Combined round failed');
}

async function main() {
  backend = await startTimeStudyServer({ outputDirectory: output, mediaFile: path.join(root, 'tests/media.webm') });
  const temporary = path.join(root, '.cache/tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const environment = { ...process.env, TEMP: temporary, TMP: temporary };
  delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: path.join(root, 'TempoBrowser-win32-x64/TempoBrowser.exe'),
    args: ['--profile=test-profile-combined-' + Date.now()], cwd: root, env: environment, colorScheme: null });
  shell = await app.firstWindow();
  await waitFor(() => page('document.title==="新标签页"'));
  for (const rule of ['client', 'server']) {
    for (let repetition = 1; repetition <= 3; repetition += 1) await round(rule, repetition);
  }
}
main().catch(error => { result.fatal = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  result.finishedAt = new Date().toISOString();
  save();
  if (app) await app.close().catch(() => {});
  if (backend) await new Promise(resolve => backend.server.close(resolve));
  console.log('COMBINED_RESULT ' + output);
});
