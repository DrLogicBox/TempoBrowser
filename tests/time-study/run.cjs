const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { startTimeStudyServer } = require('./server.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const executable = path.join(projectRoot, 'TempoBrowser-win32-x64/TempoBrowser.exe');
const studyId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const output = path.join(projectRoot, 'test-results/time-study', studyId);
fs.mkdirSync(output, { recursive: true });
const resultsFile = path.join(output, 'results.json');
const driverFile = path.join(output, 'driver.jsonl');
const results = {
  studyId,
  startedAt: new Date().toISOString(),
  output,
  executable,
  design: {
    fixedRoundSeconds: 10,
    repetitions: 3,
    transitionSegments: [{ rate: 1, seconds: 3 }, { rate: 2, seconds: 4 }, { rate: 1, seconds: 3 }],
    selectedTransitionRule: 'client',
    toleranceSeconds: 0.3,
    realClock: 'Node process.hrtime.bigint in the independent test driver',
    uiInput: 'TempoBrowser beta-1 unified acceleration switch, range Home/ArrowRight, and reset button'
  },
  appSource: [],
  rounds: [],
  screenshots: []
};
let app;
let shell;
let backend;
let inputOrder = 0;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const now = () => process.hrtime.bigint();

function persist() {
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
}

function log(event) {
  fs.appendFileSync(driverFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
}

async function waitFor(check, timeoutMs = 15000) {
  const started = now();
  let lastError;
  while (Number(now() - started) / 1e6 < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(40);
  }
  throw lastError || new Error('Study wait timed out');
}

async function pageEvaluate(expression) {
  return app.evaluate(({ BrowserWindow }, expression) => {
    const browserWindow = BrowserWindow.getAllWindows()[0];
    const view = browserWindow.contentView.children.find(child =>
      child.webContents && child.webContents !== browserWindow.webContents && child.getVisible()
    );
    if (!view) throw new Error('No visible page');
    return view.webContents.executeJavaScript(expression, true);
  }, expression);
}

async function timedAction(label, action) {
  const before = now();
  await action();
  const after = now();
  const timing = {
    label,
    order: ++inputOrder,
    beforeNs: before.toString(),
    afterNs: after.toString(),
    midpointNs: ((before + after) / 2n).toString(),
    bracketMs: Number(after - before) / 1e6
  };
  log({ event: 'input', ...timing });
  return timing;
}

async function setRate(rate) {
  const control = shell.locator('#speed');
  await control.focus();
  await control.press('Home');
  if (rate === 2) await control.press('ArrowRight');
  await waitFor(async () => (await shell.locator('#rate').innerText()) === '×' + rate);
  if (!await shell.locator('#acceleration-enabled').isChecked()) {
    await shell.locator('#acceleration-enabled').check();
  }
  await waitFor(() => pageEvaluate('globalThis.__tempo?.snapshot().enabled === true'));
}

async function waitUntilElapsed(startNs, targetSeconds) {
  const remaining = targetSeconds * 1000 - Number(now() - BigInt(startNs)) / 1e6;
  if (remaining > 0) await delay(remaining);
}

async function navigate(rule) {
  await shell.locator('#address').fill(backend.url + '/?rule=' + rule);
  await shell.locator('#address').press('Enter');
  await waitFor(() => pageEvaluate('Boolean(window.timeStudy) && timeStudy.snapshot().phase === "idle"'));
}

async function capture(name) {
  const handle = await app.evaluate(({ BrowserWindow }) => {
    const buffer = BrowserWindow.getAllWindows()[0].getNativeWindowHandle();
    return buffer.length === 8 ? Number(buffer.readBigUInt64LE()) : buffer.readUInt32LE();
  });
  const filename = path.join(output, name + '.png');
  childProcess.execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(projectRoot, 'scripts/capture-window.ps1'),
    '-WindowHandle', String(handle), '-OutputPath', filename
  ], {
    windowsHide: true,
    timeout: 20000,
    env: { ...process.env, TEMP: path.join(projectRoot, '.cache/tmp'), TMP: path.join(projectRoot, '.cache/tmp') }
  });
  results.screenshots.push(filename);
}

async function executeRound({ rule, rate, repetition, transition = false }) {
  await navigate(rule);
  await setRate(rate);
  await delay(200);
  const label = `${rule}-${transition ? '1-to-2-to-1' : 'x' + rate}-${repetition}`;
  const start = await timedAction(label + '-start', () => pageEvaluate('document.getElementById("start").click()'));
  await waitFor(() => pageEvaluate('timeStudy.snapshot().phase === "running"'));
  const firstSnapshot = await pageEvaluate('timeStudy.snapshot()');
  const pageSamples = [{ driverNs: now().toString(), page: firstSnapshot }];
  const switches = [];

  async function sampleUntil(targetSeconds) {
    while (Number(now() - BigInt(start.midpointNs)) / 1e9 < targetSeconds - 0.08) {
      const sample = await pageEvaluate('timeStudy.snapshot()');
      pageSamples.push({ driverNs: now().toString(), page: sample });
      const remaining = targetSeconds * 1000 - Number(now() - BigInt(start.midpointNs)) / 1e6;
      if (remaining > 100) await delay(Math.min(250, remaining - 80));
    }
    await waitUntilElapsed(start.midpointNs, targetSeconds);
  }

  if (transition) {
    await sampleUntil(3);
    switches.push(await timedAction(label + '-select-x2', async () => {
      await shell.locator('#speed').focus();
      await shell.locator('#speed').press('ArrowRight');
    }));
    await waitFor(async () => (await shell.locator('#rate').innerText()) === '×2');
    pageSamples.push({ driverNs: now().toString(), page: await pageEvaluate('timeStudy.snapshot()') });
    await sampleUntil(7);
    switches.push(await timedAction(label + '-restore-x1', () => shell.locator('#reset').click()));
    await waitFor(async () => (await shell.locator('#rate').innerText()) === '×1');
    pageSamples.push({ driverNs: now().toString(), page: await pageEvaluate('timeStudy.snapshot()') });
  }
  await sampleUntil(10);
  const stop = await timedAction(label + '-stop', () => pageEvaluate('document.getElementById("stop").click()'));
  await waitFor(() => pageEvaluate('timeStudy.snapshot().phase === "finished"'));
  const page = await pageEvaluate('timeStudy.snapshot()');
  const storedRun = await fetch(backend.url + '/api/results?runId=' + page.runId).then(response => response.json());
  const persistedRecords = fs.readFileSync(backend.recordsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const finalRecord = persistedRecords.find(record => record.runId === page.runId && record.event === 'final');
  const rawRequests = fs.readFileSync(backend.requestsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const finalRequest = rawRequests.find(request => request.requestId === finalRecord.requestId);
  const wirePayload = JSON.parse(Buffer.from(finalRequest.rawBodyBase64, 'base64').toString('utf8'));
  const realSeconds = Number(BigInt(stop.midpointNs) - BigInt(start.midpointNs)) / 1e9;
  let expectedPageSeconds = rate * realSeconds;
  if (transition) {
    const [accelerate, restore] = switches.map(change => BigInt(change.midpointNs));
    expectedPageSeconds = Number(accelerate - BigInt(start.midpointNs)) / 1e9 +
      2 * Number(restore - accelerate) / 1e9 + Number(BigInt(stop.midpointNs) - restore) / 1e9;
  }
  const pageSeconds = page.measurements.elapsedPerformanceMs / 1000;
  const wireReportedSeconds = wirePayload.measurements.elapsedPerformanceMs / 1000;
  const periodicRecords = storedRun.records.filter(record => record.event === 'periodic');
  const arrivalIntervals = periodicRecords.slice(1).map(record => record.arrivalIntervalSeconds);
  const pageValues = [...pageSamples.map(sample => sample.page.measurements.elapsedPerformanceMs), page.measurements.elapsedPerformanceMs];
  const monotonicPage = pageValues.every((value, index) => index === 0 || value >= pageValues[index - 1]);
  const sequences = storedRun.records.map(record => record.sequence);
  const sequencesConsecutive = sequences.every((value, index) => value === index + 1);
  const adoptionTarget = rule === 'client' ? expectedPageSeconds : realSeconds;
  const row = {
    label, rule, rate, repetition, transition,
    runId: page.runId,
    realSeconds,
    expectedPageSeconds,
    pageSeconds,
    pageDateSeconds: page.measurements.elapsedDateMs / 1000,
    pageDisplaySeconds: Number.parseFloat(page.displayedText),
    pageAnimationSeconds: page.measurements.cssElapsedMs / 1000,
    pageRafSeconds: page.measurements.rafElapsedMs / 1000,
    wireReportedSeconds,
    backendSavedClientSeconds: finalRecord.clientReportedSeconds,
    backendAdoptedSeconds: finalRecord.adoptedSeconds,
    serverIndependentSeconds: finalRecord.serverIndependentSeconds,
    serverWallSeconds: finalRecord.serverWallSeconds,
    periodicReportCount: periodicRecords.length,
    meanPeriodicArrivalSeconds: arrivalIntervals.reduce((sum, value) => sum + value, 0) / arrivalIntervals.length,
    errors: {
      pageVsExpectedSeconds: pageSeconds - expectedPageSeconds,
      pageVsExpectedPercent: 100 * (pageSeconds - expectedPageSeconds) / expectedPageSeconds,
      wireVsPageSeconds: wireReportedSeconds - pageSeconds,
      savedClientVsWireSeconds: finalRecord.clientReportedSeconds - wireReportedSeconds,
      adoptedVsRuleTargetSeconds: finalRecord.adoptedSeconds - adoptionTarget,
      serverVsRealSeconds: finalRecord.serverIndependentSeconds - realSeconds
    },
    checks: {
      aroundTenRealSeconds: Math.abs(realSeconds - 10) < 0.3,
      pageNearExpected: Math.abs(pageSeconds - expectedPageSeconds) < 0.3,
      requestMatchesFrozenPage: wireReportedSeconds === pageSeconds,
      storedClientMatchesRequest: finalRecord.clientReportedSeconds === wireReportedSeconds,
      backendUsesDeclaredRule: finalRecord.adoptedSeconds === (rule === 'client' ? wireReportedSeconds : finalRecord.serverIndependentSeconds),
      serverNearRealTime: Math.abs(finalRecord.serverIndependentSeconds - realSeconds) < 0.3,
      cumulativeTimeMonotonic: monotonicPage,
      sequencesConsecutive,
      oneFinalRecord: storedRun.records.filter(record => record.event === 'final').length === 1,
      pageVisible: page.measurements.visibilityState === 'visible',
      displayMatchesMeasurement: Math.abs(Number.parseFloat(page.displayedText) - pageSeconds) <= 0.00051,
      noPageError: !page.error
    },
    inputTimings: { start, stop, switches },
    pageSamples,
    finalPage: page,
    finalRequestId: finalRecord.requestId,
    finalRequest: { rawBody: finalRequest.rawBody, receivedAt: finalRequest.receivedAt },
    finalRecord
  };
  row.passed = Object.values(row.checks).every(Boolean);
  results.rounds.push(row);
  persist();
  console.log(JSON.stringify({ label, passed: row.passed, realSeconds, pageSeconds, wireReportedSeconds,
    backendAdoptedSeconds: finalRecord.adoptedSeconds, serverIndependentSeconds: finalRecord.serverIndependentSeconds }));
  if (repetition === 1 && (rate === 2 || transition)) await capture(label);
}

async function main() {
  for (const filename of fs.readdirSync(path.join(projectRoot, 'src'))) {
    const source = fs.readFileSync(path.join(projectRoot, 'src', filename));
    const packaged = fs.readFileSync(path.join(path.dirname(executable), 'resources/app/src', filename));
    results.appSource.push({ filename, sha256: crypto.createHash('sha256').update(source).digest('hex'), packagedMatchesSource: source.equals(packaged) });
  }
  results.executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  backend = await startTimeStudyServer({ outputDirectory: output });
  results.backendUrl = backend.url;
  const temporary = path.join(projectRoot, '.cache/tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const environment = { ...process.env, TEMP: temporary, TMP: temporary };
  delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: executable,
    args: ['--profile=test-profile-time-study-' + studyId],
    cwd: projectRoot,
    env: environment,
    colorScheme: null,
    timeout: 30000
  });
  shell = await app.firstWindow();
  shell.on('pageerror', error => log({ event: 'shell-error', message: error.message }));
  results.versions = await app.evaluate(() => process.versions);
  await waitFor(() => pageEvaluate('document.title === "新标签页"'));
  persist();
  for (const rule of ['client', 'server']) {
    for (const rate of [1, 2]) {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        await executeRound({ rule, rate, repetition });
      }
    }
  }
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    await executeRound({ rule: 'client', rate: 1, repetition, transition: true });
  }
}

main().catch(error => {
  results.fatal = error.stack;
  process.exitCode = 1;
  console.error(error);
}).finally(async () => {
  results.finishedAt = new Date().toISOString();
  persist();
  if (app) await app.close().catch(error => log({ event: 'close-error', message: error.message }));
  if (backend) await new Promise(resolve => backend.server.close(resolve));
  const { writeReport } = require('./report.cjs');
  writeReport(output);
  console.log('RESULT_DIRECTORY ' + output);
});
