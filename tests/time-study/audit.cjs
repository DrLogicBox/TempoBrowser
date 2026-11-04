const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function audit(outputDirectory) {
  const output = path.resolve(outputDirectory);
  const projectRoot = path.resolve(__dirname, '../..');
  const results = JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8'));
  const readLines = filename => fs.readFileSync(path.join(output, filename), 'utf8')
    .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const requests = readLines('requests.jsonl');
  const records = readLines('backend.jsonl');
  const requestsById = new Map(requests.map(request => [request.requestId, request]));
  const groups = new Map();
  assert.equal(results.fatal, undefined);
  assert.equal(results.rounds.length, 15);

  for (const request of requests) {
    const bytes = Buffer.from(request.rawBodyBase64, 'base64');
    assert.equal(bytes.toString('utf8'), request.rawBody);
    const headerNames = request.rawHeaders.filter((value, index) => index % 2 === 0).map(value => value.toLowerCase());
    const lengthIndex = headerNames.indexOf('content-length');
    if (lengthIndex >= 0) assert.equal(bytes.length, Number(request.rawHeaders[lengthIndex * 2 + 1]));
  }

  let matchedReports = 0;
  for (const record of records.filter(record => record.event !== 'start')) {
    const request = requestsById.get(record.requestId);
    assert(request, 'Backend record must reference a captured request');
    const payload = JSON.parse(request.rawBody);
    assert.equal(request.url, '/api/report');
    assert.equal(payload.runId, record.runId);
    assert.equal(payload.sequence, record.sequence);
    assert.equal(payload.kind, record.event);
    assert.deepEqual(payload.measurements, record.measurements);
    assert.equal(record.clientReportedSeconds, payload.measurements.elapsedPerformanceMs / 1000);
    assert.equal(record.adoptedSeconds, record.rule === 'client' ? record.clientReportedSeconds : record.serverIndependentSeconds);
    matchedReports += 1;
  }

  let maxIntervalSumErrorSeconds = 0;
  for (const round of results.rounds) {
    const key = round.transition ? 'client-transition' : round.rule + '-x' + round.rate;
    groups.set(key, (groups.get(key) || 0) + 1);
    assert.equal(round.passed, true, round.label);
    const runRecords = records.filter(record => record.runId === round.runId);
    const starts = runRecords.filter(record => record.event === 'start');
    const reports = runRecords.filter(record => record.event !== 'start');
    assert.equal(starts.length, 1);
    assert.equal(reports.filter(record => record.event === 'final').length, 1);
    assert.deepEqual(reports.map(record => record.sequence), reports.map((record, index) => index + 1));
    reports.forEach((record, index) => {
      if (index > 0) {
        assert(record.clientReportedSeconds >= reports[index - 1].clientReportedSeconds);
        assert(record.serverIndependentSeconds >= reports[index - 1].serverIndependentSeconds);
      }
    });
    const final = reports.at(-1);
    assert.deepEqual(final, round.finalRecord);
    assert.equal(final.clientReportedSeconds, round.pageSeconds);
    assert.equal(final.adoptedSeconds, round.backendAdoptedSeconds);
    const summedIntervals = reports.reduce((sum, record) => sum + record.arrivalIntervalSeconds, 0);
    const intervalError = Math.abs(summedIntervals - final.serverIndependentSeconds);
    maxIntervalSumErrorSeconds = Math.max(maxIntervalSumErrorSeconds, intervalError);
    assert(intervalError < 1e-10);
  }
  assert.deepEqual([...groups.keys()].sort(), ['client-transition', 'client-x1', 'client-x2', 'server-x1', 'server-x2']);
  assert([...groups.values()].every(count => count === 3));

  for (const source of results.appSource) {
    const current = fs.readFileSync(path.join(projectRoot, 'src', source.filename));
    const packaged = fs.readFileSync(path.join(path.dirname(results.executable), 'resources/app/src', source.filename));
    assert.equal(crypto.createHash('sha256').update(current).digest('hex'), source.sha256);
    assert(current.equals(packaged));
  }
  const summary = {
    checkedAt: new Date().toISOString(),
    rounds: results.rounds.length,
    requests: requests.length,
    matchedReports,
    independentIntervalSumMaxErrorSeconds: maxIntervalSumErrorSeconds,
    appSourceMatchesStartAndPackaged: true,
    groups: Object.fromEntries(groups),
    passed: true
  };
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  return summary;
}

module.exports = { audit };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Provide the result directory');
  audit(process.argv[2]);
}
