const elements = Object.fromEntries(
  ['start', 'stop', 'rule', 'phase', 'elapsed', 'date-elapsed', 'adopted', 'server-elapsed', 'last-response', 'error', 'animation']
    .map(id => [id, document.getElementById(id)])
);
const requestedRule = new URLSearchParams(location.search).get('rule');
if (['client', 'server'].includes(requestedRule)) elements.rule.value = requestedRule;

let phase = 'idle';
let runId = null;
let performanceStart = 0;
let dateStart = 0;
let animationStart = 0;
let rafStart = null;
let rafElapsedMs = 0;
let timerTicks = 0;
let reportTimer = null;
let frozen = null;
let sequence = 0;
let lastResponse = null;
let reportQueue = Promise.resolve();

function measure() {
  if (frozen) return { ...frozen };
  const elapsedPerformanceMs = phase === 'idle' ? 0 : performance.now() - performanceStart;
  return {
    elapsedPerformanceMs,
    elapsedDateMs: phase === 'idle' ? 0 : Date.now() - dateStart,
    cssElapsedMs: phase === 'idle' ? 0 : elements.animation.getAnimations()[0].currentTime - animationStart,
    rafElapsedMs,
    timerTicks,
    visibilityState: document.visibilityState,
    displayedSeconds: (elapsedPerformanceMs / 1000).toFixed(3)
  };
}

function render() {
  const value = measure();
  elements.elapsed.textContent = value.displayedSeconds + ' s';
  elements['date-elapsed'].textContent = (value.elapsedDateMs / 1000).toFixed(3) + ' s';
  elements.phase.textContent = { idle: '准备就绪', starting: '建立后台记录', running: '计时与周期上报中', stopping: '等待最终上报', finished: '最终记录已保存', error: '上报异常' }[phase];
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const record = await response.json();
  if (!response.ok) throw new Error(record.error || 'Report request failed');
  return record;
}

function enqueueReport(kind, measurements) {
  const payload = { runId, sequence: ++sequence, kind, measurements };
  reportQueue = reportQueue.then(async () => {
    const record = await post('/api/report', payload);
    lastResponse = record;
    elements.adopted.textContent = record.adoptedSeconds.toFixed(3) + ' s';
    elements['server-elapsed'].textContent = record.serverIndependentSeconds.toFixed(3) + ' s';
    elements['last-response'].textContent = JSON.stringify(record, null, 2);
  });
  reportQueue.catch(showError);
  return reportQueue;
}

function showError(error) {
  phase = 'error';
  elements.error.textContent = error.message;
  render();
}

async function beginRun() {
  if (phase !== 'idle') return;
  performanceStart = performance.now();
  dateStart = Date.now();
  animationStart = elements.animation.getAnimations()[0].currentTime;
  phase = 'starting';
  elements.start.disabled = true;
  elements.rule.disabled = true;
  render();
  try {
    const record = await post('/api/start', { rule: elements.rule.value });
    runId = record.runId;
    phase = 'running';
    elements.stop.disabled = false;
    reportTimer = setInterval(() => {
      timerTicks += 1;
      enqueueReport('periodic', measure());
    }, 1000);
    render();
  } catch (error) {
    showError(error);
  }
}

async function finishRun() {
  if (phase !== 'running') return;
  frozen = measure();
  clearInterval(reportTimer);
  phase = 'stopping';
  elements.stop.disabled = true;
  render();
  try {
    await enqueueReport('final', frozen);
    phase = 'finished';
    render();
  } catch (error) {
    showError(error);
  }
}

function frame(timestamp) {
  if (phase === 'running' || phase === 'starting') {
    if (rafStart === null) rafStart = timestamp;
    rafElapsedMs = timestamp - rafStart;
    render();
  }
  requestAnimationFrame(frame);
}

elements.start.addEventListener('click', beginRun);
elements.stop.addEventListener('click', finishRun);
requestAnimationFrame(frame);
window.timeStudy = {
  snapshot() {
    return {
      phase, runId, rule: elements.rule.value, sequence, measurements: measure(),
      lastResponse,
      displayedText: elements.elapsed.textContent,
      error: elements.error.textContent
    };
  }
};
